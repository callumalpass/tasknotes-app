import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ID, BUNDLE_ID, createClient } from "./submit-app-store.mjs";
import {
  uploadRefusal,
  uploadRefusalClass,
} from "./testflight-upload-refusal.mjs";

// altool's exit status and wording are not proof that a build reached Apple:
// the success phrase changes between Xcode releases. App Store Connect is the
// authority. After altool exits 0, the exact build (app, marketing version and
// build number) must become visible through the API within a bounded wait.
// A known success phrase is only a hint used to pick the refusal class.
//
// Nothing here prints or retains the altool log, keys, tokens or API bodies:
// the only output is a fixed class code.
export const SUCCESS_HINT = /No errors uploading|UPLOAD SUCCEEDED/i;
export const BUILD_NOT_VISIBLE = "testflight-build-not-visible";
export const BUILD_LOOKUP_FAILED = "testflight-build-lookup-failed";
export const BUILD_NUMBER_TAKEN = "testflight-build-number-taken";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const VERSION = /^\d+(?:\.\d+){1,2}$/;
const BUILD = /^[1-9]\d*$/;

function checkIdentity(version, build) {
  if (!VERSION.test(version ?? "") || !BUILD.test(build ?? ""))
    throw new Error("Invalid iOS version or build number");
}

// Returns true only when App Store Connect lists exactly this build for the
// TaskNotes app (bundle id checked through the included app resource).
export async function findExactBuild(client, version, build) {
  checkIdentity(version, build);
  const query = new URLSearchParams({
    "filter[app]": APP_ID,
    "filter[version]": build,
    "filter[preReleaseVersion.version]": version,
    "filter[preReleaseVersion.platform]": "IOS",
    include: "app,preReleaseVersion",
    limit: "2",
  });
  const page = await client.request(`builds?${query}`);
  const included = page.included ?? [];
  const related = (item, name) => {
    const ref = item.relationships?.[name]?.data;
    return included.find(
      (item) => item.type === ref?.type && item.id === ref?.id,
    );
  };
  return (page.data ?? []).some(
    (item) =>
      item.type === "builds" &&
      item.attributes?.version === build &&
      related(item, "app")?.attributes?.bundleId === BUNDLE_ID &&
      related(item, "preReleaseVersion")?.attributes?.version === version,
  );
}

export async function confirmUpload({
  client,
  log,
  status,
  version,
  build,
  attempts = 20,
  intervalMs = 30_000,
  sleepImpl = sleep,
}) {
  // A failed altool run keeps the existing classification; Apple is not asked.
  if (String(status) !== "0")
    return { confirmed: false, reason: uploadRefusalClass(log, status) };
  let lookups = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (await findExactBuild(client, version, build))
        return { confirmed: true };
      lookups++;
    } catch {
      // Transient or unauthorized reads are retried within the same bound.
    }
    if (attempt + 1 < attempts) await sleepImpl(intervalMs);
  }
  if (!lookups) return { confirmed: false, reason: BUILD_LOOKUP_FAILED };
  // No success phrase and a recognisable Apple refusal: report that instead.
  if (typeof log === "string" && !SUCCESS_HINT.test(log)) {
    const reason = uploadRefusalClass(log, status);
    if (reason !== BUILD_NOT_VISIBLE) return { confirmed: false, reason };
  }
  return { confirmed: false, reason: BUILD_NOT_VISIBLE };
}

// The build number is the release run number (every dispatch is a new run and
// reruns are refused), so an unconfirmed upload is never retried with the same
// number. This preflight additionally refuses before signing when App Store
// Connect already holds this or a higher build for the version, for example
// from an upload that reached Apple without confirmation.
export function highestBuildNumber(builds) {
  let highest = 0;
  for (const item of builds) {
    const value = item?.attributes?.version;
    if (BUILD.test(value ?? "")) highest = Math.max(highest, Number(value));
  }
  return highest;
}

export async function checkBuildNumberUnused({ client, version, build }) {
  checkIdentity(version, build);
  const query = new URLSearchParams({
    "filter[app]": APP_ID,
    "filter[preReleaseVersion.version]": version,
    "filter[preReleaseVersion.platform]": "IOS",
    "fields[builds]": "version",
    limit: "200",
  });
  let builds;
  try {
    builds = await client.list(`builds?${query}`);
  } catch {
    return { ok: false, reason: BUILD_LOOKUP_FAILED };
  }
  const highest = highestBuildNumber(builds);
  return Number(build) > highest
    ? { ok: true, highest }
    : { ok: false, reason: BUILD_NUMBER_TAKEN, highest };
}

function clientFromEnv(env) {
  const value = (name) => {
    const text = env[name]?.trim();
    if (!text) throw new Error("App Store Connect credential missing");
    return text;
  };
  return createClient({
    keyId: value("APP_STORE_CONNECT_KEY_ID"),
    issuerId: value("APP_STORE_CONNECT_ISSUER_ID"),
    privateKey: Buffer.from(
      value("APP_STORE_CONNECT_PRIVATE_KEY_BASE64"),
      "base64",
    ).toString("utf8"),
  });
}

async function refuse(reason, env) {
  const receipt = uploadRefusal(reason, Number(env.GITHUB_RUN_ID));
  await writeFile(
    resolve(env.GITHUB_WORKSPACE ?? ".", "testflight-upload-result.json"),
    JSON.stringify(receipt) + "\n",
  );
  console.error(`TestFlight upload refused: ${receipt.reason}`);
  if (env.GITHUB_STEP_SUMMARY)
    await appendFile(
      env.GITHUB_STEP_SUMMARY,
      `TestFlight upload refused: \`${receipt.reason}\`\n`,
    );
  process.exitCode = 1;
}

export async function main(
  argv = process.argv.slice(2),
  env = process.env,
  options = {},
) {
  const [command, logPath, status] = argv;
  const version = env.TASKNOTES_IOS_VERSION;
  const build = env.TASKNOTES_IOS_BUILD;
  let client;
  const lookupClient = () => {
    try {
      return (client ??= options.client ?? clientFromEnv(env));
    } catch {
      return null;
    }
  };
  if (command === "preflight") {
    const api = lookupClient();
    const result = api
      ? await checkBuildNumberUnused({ client: api, version, build })
      : { ok: false, reason: BUILD_LOOKUP_FAILED };
    if (!result.ok) return refuse(result.reason, env);
    console.log("TestFlight build number is unused in App Store Connect.");
    return;
  }
  if (command === "confirm") {
    let log;
    try {
      log = await readFile(logPath, "utf8");
    } catch {
      log = undefined;
    }
    const api = String(status) === "0" ? lookupClient() : null;
    const result =
      String(status) === "0" && !api
        ? { confirmed: false, reason: BUILD_LOOKUP_FAILED }
        : await confirmUpload({
            client: api,
            log,
            status,
            version,
            build,
            ...options.confirm,
          });
    if (!result.confirmed) return refuse(result.reason, env);
    console.log("App Store Connect lists the uploaded TestFlight build.");
    if (env.GITHUB_STEP_SUMMARY)
      await appendFile(
        env.GITHUB_STEP_SUMMARY,
        "TestFlight upload confirmed by App Store Connect.\n",
      );
    return;
  }
  throw new Error(
    "Usage: testflight-upload.mjs preflight | confirm LOG STATUS",
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch(() => {
    console.error("TestFlight upload could not be confirmed or classified.");
    process.exitCode = 1;
  });
}

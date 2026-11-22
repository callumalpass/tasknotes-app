import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ID, BUNDLE_ID, createClient } from "./submit-app-store.mjs";

// Store CD numbers releases from the live store version, not package.json,
// so the reader reports the newest App Store version record (the one a
// release is working on) and the build attached to it.
const NUMERIC = /^\d+\.\d+\.\d+$/;
const compareVersions = (a, b) => {
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
};
const liveStates = new Set(["READY_FOR_SALE", "READY_FOR_DISTRIBUTION"]);
function newest(versions) {
  return versions
    .map((item) => item.attributes.versionString)
    .filter((value) => NUMERIC.test(value ?? ""))
    .sort(compareVersions)
    .at(-1);
}

function buildOf(build) {
  if (!build) return null;
  if (!/^[1-9]\d*$/.test(build.attributes?.version ?? ""))
    throw new Error("Unexpected build number");
  return {
    buildNumber: build.attributes.version,
    processingState: enumValue(build.attributes.processingState),
  };
}

function required(value, name) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${name} is required`);
  return value.trim();
}

function enumValue(value) {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value))
    throw new Error("Unexpected App Store status value");
  return value;
}

// The status caller has no write method. The transport also rejects any write,
// even if a future change accidentally tries to use one through a shared helper.
export function createStatusClient(credentials, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const client = createClient(credentials, {
    ...options,
    fetchImpl: (url, init) => {
      if (init.method !== "GET" || init.body !== undefined)
        throw new Error("App Store status only permits GET requests");
      return fetchImpl(url, init);
    },
  });
  return {
    get: (path) => client.request(path, "GET"),
    list: (path) => client.list(path),
  };
}

export async function readAppStoreStatus(client) {
  const app = (await client.get(`apps/${APP_ID}?fields[apps]=bundleId`)).data;
  if (app?.attributes?.bundleId !== BUNDLE_ID)
    throw new Error("Unexpected app bundle ID");
  const versions = await client.list(
    `apps/${APP_ID}/appStoreVersions?${new URLSearchParams({
      "filter[platform]": "IOS",
      "fields[appStoreVersions]": "versionString,appStoreState,releaseType",
    })}`,
  );
  const version = newest(versions);
  const live = newest(
    versions.filter((item) => liveStates.has(item.attributes.appStoreState)),
  );
  const targets = version
    ? versions.filter((item) => item.attributes.versionString === version)
    : [];
  if (targets.length > 1)
    throw new Error(
      "Multiple App Store versions matched the requested version",
    );
  const target = targets[0];
  const submissions = await client.list(
    `reviewSubmissions?${new URLSearchParams({
      "filter[app]": APP_ID,
      "filter[platform]": "IOS",
      "fields[reviewSubmissions]": "state",
    })}`,
  );
  const active = [];
  if (target) {
    for (const submission of submissions) {
      if (submission.attributes.state === "COMPLETE") continue;
      const items = await client.list(
        `reviewSubmissions/${submission.id}/items?${new URLSearchParams({
          include: "appStoreVersion",
          "fields[reviewSubmissionItems]": "appStoreVersion",
          "fields[appStoreVersions]": "versionString",
        })}`,
      );
      if (
        items.some(
          (item) => item.relationships?.appStoreVersion?.data?.id === target.id,
        )
      )
        active.push(submission);
    }
  }
  if (active.length > 1)
    throw new Error("Multiple active review submissions matched this version");
  const attached = target
    ? (
        await client.get(
          `appStoreVersions/${target.id}/build?${new URLSearchParams({
            "fields[builds]": "version,processingState",
          })}`,
        )
      ).data
    : null;
  // One page, sorted newest first. Do not follow pagination and call an older
  // build the latest, or query builds belonging to a different marketing version.
  const builds = !version
    ? []
    : (
        await client.get(
          `builds?${new URLSearchParams({
            "filter[app]": APP_ID,
            "filter[preReleaseVersion.version]": version,
            "filter[preReleaseVersion.platform]": "IOS",
            "fields[builds]": "version,processingState,uploadedDate",
            sort: "-uploadedDate",
            limit: "1",
          })}`,
        )
      ).data;
  if (builds.length > 1)
    throw new Error("Latest build query returned multiple builds");
  return {
    version: version ?? "NOT_FOUND",
    liveVersion: live ?? "NONE",
    appStoreState: target
      ? enumValue(target.attributes.appStoreState)
      : "NOT_FOUND",
    releaseType: target
      ? enumValue(target.attributes.releaseType)
      : "NOT_FOUND",
    reviewSubmissionState: active.length
      ? enumValue(active[0].attributes.state)
      : "NONE",
    attachedBuild: buildOf(attached),
    latestBuild: buildOf(builds[0]),
  };
}

export function statusSummary(status) {
  const build = (value) =>
    value ? `${value.buildNumber} (${value.processingState})` : "NONE";
  return `${status.version}: ${status.appStoreState} (${status.releaseType})\n\nLive version: ${status.liveVersion}. Review submission: ${status.reviewSubmissionState}. Attached build: ${build(status.attachedBuild)}. Latest uploaded build: ${build(status.latestBuild)}.\n`;
}

async function main() {
  const client = createStatusClient({
    keyId: required(
      process.env.APP_STORE_CONNECT_KEY_ID,
      "APP_STORE_CONNECT_KEY_ID",
    ),
    issuerId: required(
      process.env.APP_STORE_CONNECT_ISSUER_ID,
      "APP_STORE_CONNECT_ISSUER_ID",
    ),
    privateKey: Buffer.from(
      required(
        process.env.APP_STORE_CONNECT_PRIVATE_KEY_BASE64,
        "APP_STORE_CONNECT_PRIVATE_KEY_BASE64",
      ),
      "base64",
    ).toString("utf8"),
  });
  const status = await readAppStoreStatus(client);
  console.log(JSON.stringify(status));
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, statusSummary(status));
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

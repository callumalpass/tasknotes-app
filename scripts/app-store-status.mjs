import { readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ID, BUNDLE_ID, createClient } from "./submit-app-store.mjs";

// Report the version this commit releases, so the reader never lags a bump.
export const VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

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
  const targets = versions.filter(
    (item) => item.attributes.versionString === VERSION,
  );
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
  // One page, sorted newest first. Do not follow pagination and call an older
  // build the latest, or query builds belonging to a different marketing version.
  const builds = (
    await client.get(
      `builds?${new URLSearchParams({
        "filter[app]": APP_ID,
        "filter[preReleaseVersion.version]": VERSION,
        "filter[preReleaseVersion.platform]": "IOS",
        "fields[builds]": "version,processingState,uploadedDate",
        sort: "-uploadedDate",
        limit: "1",
      })}`,
    )
  ).data;
  if (builds.length > 1)
    throw new Error("Latest build query returned multiple builds");
  const build = builds[0];
  if (build && !/^[1-9]\d*$/.test(build.attributes.version))
    throw new Error("Unexpected build number");
  return {
    version: VERSION,
    appStoreState: target
      ? enumValue(target.attributes.appStoreState)
      : "NOT_FOUND",
    releaseType: target
      ? enumValue(target.attributes.releaseType)
      : "NOT_FOUND",
    reviewSubmissionState: active.length
      ? enumValue(active[0].attributes.state)
      : "NONE",
    latestBuild: build
      ? {
          buildNumber: build.attributes.version,
          processingState: enumValue(build.attributes.processingState),
        }
      : null,
  };
}

export function statusSummary(status) {
  return `${status.version}: ${status.appStoreState} (${status.releaseType})\n\nReview submission: ${status.reviewSubmissionState}. Latest build: ${status.latestBuild ? `${status.latestBuild.buildNumber} (${status.latestBuild.processingState})` : "NONE"}.\n`;
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

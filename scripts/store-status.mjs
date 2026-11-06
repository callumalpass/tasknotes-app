import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLAY_PACKAGE,
  parseServiceAccount,
  exchangeAccessToken,
} from "./publish-google-play.mjs";
import { APP_ID } from "./submit-app-store.mjs";
import { createStatusClient } from "./app-store-status.mjs";

// The edit is a disposable snapshot: never upload, update a track, validate,
// or commit. Only insert, GET and delete are allowed by this transport.
export async function readPlayStatus(credentialBase64, fetchImpl = fetch) {
  const token = await exchangeAccessToken(
    parseServiceAccount(credentialBase64),
    {
      fetchImpl,
    },
  );
  const root = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY_PACKAGE}/edits`;
  async function request(url, method = "GET") {
    if (!(
      (url === root && method === "POST") ||
      (url.startsWith(root + "/") && ["GET", "DELETE"].includes(method))
    ))
      throw new Error("Read-only Play transport refused a write");
    const response = await fetchImpl(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      headers: {
        authorization: `Bearer ${token}`,
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    if (!response.ok)
      throw new Error(`Play status unavailable (HTTP ${response.status})`);
    return response.status === 204 ? null : response.json();
  }
  let edit;
  try {
    edit = await request(root, "POST");
    if (!/^[A-Za-z0-9_-]+$/.test(edit?.id ?? ""))
      throw new Error("Invalid disposable Play edit");
    const snapshot = await request(`${root}/${edit.id}/tracks`);
    const tracks = (snapshot.tracks ?? [])
      .filter((t) => ["production", "alpha"].includes(t.track))
      .map((t) => ({
        track: t.track,
        releases: (t.releases ?? []).map((r) => ({
          versionCodes: r.versionCodes,
          name: r.name,
          status: r.status,
          userFraction: r.userFraction ?? null,
        })),
      }));
    const production = tracks.find((t) => t.track === "production");
    return {
      schema: "tasknotes/store-status/1",
      platform: "android",
      observedAt: new Date().toISOString(),
      productionAccess: production?.releases.some((r) =>
        ["completed", "inProgress", "halted"].includes(r.status),
      )
        ? "confirmed-by-existing-production-release"
        : "unverified",
      // Track state is not review state or proof that every country serves it.
      reviewState: "not-exposed-by-android-publisher-api",
      liveVersion:
        production?.releases
          ?.map((r) => /^TaskNotes (\d+\.\d+\.\d+)$/.exec(r.name ?? "")?.[1])
          .filter(Boolean)
          .sort(compareVersions)
          .at(-1) ?? null,
      live: production?.releases ?? [],
      tracks,
    };
  } finally {
    if (edit?.id && /^[A-Za-z0-9_-]+$/.test(edit.id))
      await request(`${root}/${edit.id}`, "DELETE");
  }
}

function compareVersions(a, b) {
  const aa = a.split(".").map(Number),
    bb = b.split(".").map(Number);
  return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2];
}

export async function readAppleLive(client) {
  const versions = await client.list(
    `apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&fields[appStoreVersions]=versionString,appStoreState,releaseType`,
  );
  const available = versions.filter((v) =>
    ["READY_FOR_SALE", "READY_FOR_DISTRIBUTION"].includes(
      v.attributes.appStoreState,
    ),
  );
  const newest = available
    .map((v) => v.attributes.versionString)
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .sort(compareVersions)
    .at(-1);
  return {
    schema: "tasknotes/store-status/1",
    platform: "ios",
    observedAt: new Date().toISOString(),
    liveVersion: newest ?? null,
    live: versions
      .filter(
        (v) =>
          ["READY_FOR_SALE", "READY_FOR_DISTRIBUTION"].includes(
            v.attributes.appStoreState,
          ) && v.attributes.versionString === newest,
      )
      .map((v) => ({
        version: v.attributes.versionString,
        state: v.attributes.appStoreState,
      })),
    versions: versions.map((v) => ({
      version: v.attributes.versionString,
      state: v.attributes.appStoreState,
      releaseType: v.attributes.releaseType,
    })),
  };
}

async function main() {
  const platform = process.argv[2];
  let status;
  if (platform === "android") {
    status = await readPlayStatus(
      process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64,
    );
  } else if (platform === "ios") {
    status = await readAppleLive(
      createStatusClient({
        keyId: process.env.APP_STORE_CONNECT_KEY_ID,
        issuerId: process.env.APP_STORE_CONNECT_ISSUER_ID,
        privateKey: Buffer.from(
          process.env.APP_STORE_CONNECT_PRIVATE_KEY_BASE64 ?? "",
          "base64",
        ).toString("utf8"),
      }),
    );
  } else throw new Error("Expected android or ios");
  await writeFile(
    `store-status-${platform}.json`,
    JSON.stringify(status, null, 2) + "\n",
  );
  console.log(JSON.stringify(status));
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
)
  main().catch(() => {
    console.error(
      "Store status unavailable; no production write was attempted.",
    );
    process.exitCode = 1;
  });

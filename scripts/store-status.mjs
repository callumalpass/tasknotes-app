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
import { googleApiFailure } from "./google-api-failure.mjs";

// The edit is a disposable snapshot: never upload, update a track, validate,
// or commit. Only insert, GET and delete are allowed by this transport.
export async function readPlayStatus(credentialBase64, fetchImpl = fetch) {
  const token = await exchangeAccessToken(
    parseServiceAccount(credentialBase64),
    {
      fetchImpl,
    },
  );
  const app = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY_PACKAGE}`;
  const root = `${app}/edits`;
  const summaryUrls = new Set();
  let reviewHttpStatus = null;
  async function request(url, method = "GET") {
    if (!(
      (url === root && method === "POST") ||
      (url.startsWith(root + "/") && ["GET", "DELETE"].includes(method)) ||
      (summaryUrls.has(url) && method === "GET")
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
    if (summaryUrls.has(url)) reviewHttpStatus = response.status;
    if (!response.ok) throw await googleApiFailure(response);
    return response.status === 204 ? null : response.json();
  }
  let edit;
  try {
    edit = await request(root, "POST");
    if (!/^[A-Za-z0-9_-]+$/.test(edit?.id ?? ""))
      throw new Error("Invalid disposable Play edit");
    const snapshot = await request(`${root}/${edit.id}/tracks`);
    const tracks = (snapshot.tracks ?? []).map((t) => ({
      track: t.track,
      releases: (t.releases ?? []).map((r) => ({
        versionCodes: r.versionCodes,
        name: r.name,
        status: r.status,
        userFraction: r.userFraction ?? null,
      })),
    }));
    // Unlike edits.tracks.list, this non-edit API exposes Console review
    // lifecycle (including rejection). Read EVERY track, not just production.
    let review;
    let reviewStep = "discover-tracks";
    try {
      const releases = [];
      if (!tracks.some((t) => t.track === "production"))
        throw new Error("missing-track");
      for (const track of tracks) {
        const url = `${app}/tracks/${encodeURIComponent(track.track)}/releases`;
        summaryUrls.add(url);
        reviewStep = "request-release-summaries";
        const result = await request(url);
        reviewStep = "validate-release-summaries";
        if (
          !Array.isArray(result.releases ?? []) ||
          (result.releases ?? []).length >= 20
        )
          throw new Error("incomplete-review-snapshot");
        for (const release of result.releases ?? []) {
          if (
            release.track !== track.track ||
            !REVIEW_STATES.includes(release.releaseLifecycleState)
          )
            throw new Error("unknown-review-state");
          releases.push({
            track: track.track,
            state: release.releaseLifecycleState,
            versionCodes: (release.activeArtifacts ?? []).map((a) =>
              String(a.versionCode),
            ),
          });
        }
      }
      review = { available: true, releases };
    } catch (error) {
      // Keep the nearest observable track state, but never call it review proof.
      review = {
        available: false,
        releases: [],
        failedStep: "applications.tracks.releases.list",
        httpStatus: error.httpStatus ?? reviewHttpStatus,
        operation: reviewStep,
        reason:
          error.reason ??
          ([
            "missing-track",
            "incomplete-review-snapshot",
            "unknown-review-state",
          ].includes(error.message)
            ? error.message
            : error instanceof TypeError
              ? "review-transport-or-shape-error"
              : error instanceof SyntaxError
                ? "review-invalid-json"
                : error.name === "TimeoutError"
                  ? "review-request-timeout"
                  : "review-observation-unavailable"),
      };
    }
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
      reviewState: review.available
        ? "observed-release-lifecycle"
        : "release-lifecycle-unavailable",
      review,
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

const REVIEW_STATES = [
  "RELEASE_LIFECYCLE_STATE_DRAFT",
  "RELEASE_LIFECYCLE_STATE_NOT_SENT_FOR_REVIEW",
  "RELEASE_LIFECYCLE_STATE_IN_REVIEW",
  "RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED",
  "RELEASE_LIFECYCLE_STATE_NOT_APPROVED",
  "RELEASE_LIFECYCLE_STATE_PUBLISHED",
];
export function playReviewBlock(status) {
  if (status.review?.available !== true)
    return "play-release-lifecycle-observer-unavailable";
  const releases = status.review.releases;
  if (
    !Array.isArray(releases) ||
    releases.some((r) => !REVIEW_STATES.includes(r.state))
  )
    return "play-release-lifecycle-observer-unavailable";
  if (releases.some((r) => r.state === "RELEASE_LIFECYCLE_STATE_NOT_APPROVED"))
    return "store-rejected";
  if (releases.some((r) => r.state !== "RELEASE_LIFECYCLE_STATE_PUBLISHED"))
    return "earlier-store-version-in-flight";
  // A published production summary must corroborate the track snapshot.
  if (
    status.live.some(
      (r) =>
        !(r.versionCodes ?? []).every((code) =>
          releases.some(
            (s) => s.track === "production" && s.versionCodes.includes(code),
          ),
        ),
    )
  )
    return "play-release-lifecycle-observer-unavailable";
  return null;
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

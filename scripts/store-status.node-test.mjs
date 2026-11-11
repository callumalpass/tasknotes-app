import test from "node:test";
import assert from "node:assert/strict";
import {
  readAppleLive,
  readPlayStatus,
  playReviewBlock,
  readWithRetry,
} from "./store-status.mjs";
import { generateKeyPairSync } from "node:crypto";

test("Play snapshot cannot commit or update and always deletes", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const credential = Buffer.from(
    JSON.stringify({
      type: "service_account",
      client_email: "test@example.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
      token_uri: "https://oauth2.googleapis.com/token",
    }),
  ).toString("base64");
  const calls = [];
  const status = await readPlayStatus(credential, async (url, options) => {
    calls.push([url, options.method]);
    if (url.includes("oauth2")) return Response.json({ access_token: "test" });
    if (options.method === "POST") return Response.json({ id: "123" });
    if (options.method === "DELETE") return new Response(null, { status: 204 });
    if (url.endsWith("/tracks/production/releases"))
      return Response.json({
        releases: [
          {
            track: "production",
            releaseLifecycleState: "RELEASE_LIFECYCLE_STATE_PUBLISHED",
            activeArtifacts: [{ versionCode: 101 }],
          },
        ],
      });
    return Response.json({
      tracks: [
        {
          track: "production",
          releases: [
            {
              name: "TaskNotes 1.0.11",
              status: "completed",
              versionCodes: ["101"],
            },
          ],
        },
      ],
    });
  });
  assert.equal(
    status.productionAccess,
    "confirmed-by-existing-production-release",
  );
  assert.equal(status.liveVersion, "1.0.11");
  assert.deepEqual(
    calls.map((c) => c[1]),
    ["POST", "POST", "GET", "GET", "DELETE"],
  );
  assert.ok(!calls.some(([url]) => url.includes(":commit")));
  assert.equal(playReviewBlock(status), null);
  assert.equal(status.reviewState, "observed-release-lifecycle");
});

test("Apple histories with READY_FOR_SALE select the numeric newest", async () => {
  const result = await readAppleLive({
    list: async () =>
      ["1.0.9", "1.0.12", "1.0.10"].map((versionString) => ({
        attributes: { versionString, appStoreState: "READY_FOR_SALE" },
      })),
  });
  assert.equal(result.liveVersion, "1.0.12");
  assert.equal(result.live.length, 1);
});

test("Apple reports actual live version, not package version", async () => {
  const result = await readAppleLive({
    list: async () => [
      {
        attributes: { versionString: "1.0.8", appStoreState: "READY_FOR_SALE" },
      },
      { attributes: { versionString: "1.0.12", appStoreState: "IN_REVIEW" } },
    ],
  });
  assert.deepEqual(result.live, [
    { version: "1.0.8", state: "READY_FOR_SALE" },
  ]);
});

test("a transient status read is retried, bounded, without waiting for real", async () => {
  const waits = [];
  let calls = 0;
  const status = await readWithRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return { ok: true };
    },
    { wait: async (ms) => waits.push(ms) },
  );
  assert.deepEqual(status, { ok: true });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10_000, 10_000]);

  let failures = 0;
  await assert.rejects(
    readWithRetry(
      async () => {
        failures++;
        throw new Error("down");
      },
      { attempts: 3, wait: async () => {} },
    ),
    /down/,
  );
  assert.equal(failures, 3);
});

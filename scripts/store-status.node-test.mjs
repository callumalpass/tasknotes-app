import test from "node:test";
import assert from "node:assert/strict";
import { readAppleLive, readPlayStatus } from "./store-status.mjs";
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
  assert.deepEqual(
    calls.map((c) => c[1]),
    ["POST", "POST", "GET", "DELETE"],
  );
  assert.ok(!calls.some(([url]) => url.includes(":commit")));
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

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readPlayStatus, playReviewBlock } from "./store-status.mjs";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const credential = Buffer.from(
  JSON.stringify({
    type: "service_account",
    client_email: "test@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    token_uri: "https://oauth2.googleapis.com/token",
  }),
).toString("base64");

for (const productionEmpty of [false, true]) {
  test(`204 empty-track summary does not fabricate production approval (${productionEmpty})`, async () => {
    const result = await readPlayStatus(credential, async (url, options) => {
      if (url.includes("oauth2"))
        return Response.json({ access_token: "test" });
      if (options.method === "POST") return Response.json({ id: "123" });
      if (options.method === "DELETE")
        return new Response(null, { status: 204 });
      if (url.endsWith("/tracks/production/releases") && !productionEmpty)
        return Response.json({
          releases: [
            {
              track: "production",
              releaseLifecycleState: "RELEASE_LIFECYCLE_STATE_PUBLISHED",
              activeArtifacts: [{ versionCode: 101 }],
            },
          ],
        });
      if (url.endsWith("/releases")) return new Response(null, { status: 204 });
      return Response.json({
        tracks: [
          {
            track: "production",
            releases: [{ status: "completed", versionCodes: ["101"] }],
          },
          { track: "beta", releases: [] },
          { track: "internal", releases: [{ status: "draft" }] },
        ],
      });
    });
    assert.equal(result.review.available, true);
    assert.equal(
      playReviewBlock(result),
      productionEmpty ? "play-release-lifecycle-observer-unavailable" : null,
    );
  });
}

for (const malformed of [
  null,
  {
    releases: [
      {
        track: "production",
        releaseLifecycleState: "RELEASE_LIFECYCLE_STATE_PUBLISHED",
        activeArtifacts: {},
      },
    ],
  },
]) {
  test("successful HTTP with malformed summaries retains bounded status/operation", async () => {
    const result = await readPlayStatus(credential, async (url, options) => {
      if (url.includes("oauth2"))
        return Response.json({ access_token: "test" });
      if (options.method === "POST") return Response.json({ id: "123" });
      if (options.method === "DELETE")
        return new Response(null, { status: 204 });
      if (url.endsWith("/releases")) return Response.json(malformed);
      return Response.json({ tracks: [{ track: "production", releases: [] }] });
    });
    assert.equal(result.review.available, false);
    assert.equal(result.review.httpStatus, 200);
    assert.equal(result.review.operation, "validate-release-summaries");
    assert.equal(result.review.reason, "review-transport-or-shape-error");
    assert.ok(!JSON.stringify(result).includes("access_token"));
  });
}

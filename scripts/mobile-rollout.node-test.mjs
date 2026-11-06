import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { setProductionRollout } from "./publish-google-play.mjs";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const credentialBase64 = Buffer.from(
  JSON.stringify({
    type: "service_account",
    client_email: "test@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    token_uri: "https://oauth2.googleapis.com/token",
  }),
).toString("base64");
test("halts exact staged release and preserves previous completed release", async () => {
  const calls = [];
  const older = {
    name: "TaskNotes 1.0.11",
    versionCodes: ["122"],
    status: "completed",
  };
  const current = {
    name: "TaskNotes 1.0.12",
    versionCodes: ["123"],
    status: "inProgress",
    userFraction: 0.1,
  };
  await setProductionRollout({
    credentialBase64,
    expectedVersionCode: "123",
    status: "halted",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes("oauth2"))
        return Response.json({ access_token: "test" });
      if (url.endsWith("/edits")) return Response.json({ id: "edit" });
      if (options.method === "PUT") {
        const body = JSON.parse(options.body);
        assert.deepEqual(body.releases[0], older);
        assert.equal(body.releases[1].status, "halted");
        assert.equal(body.releases[1].userFraction, 0.1);
        return Response.json(body);
      }
      if (url.endsWith("/tracks/production"))
        return Response.json({
          track: "production",
          releases: [older, current],
        });
      return Response.json({});
    },
  });
  assert.equal(calls.filter((c) => c.url.endsWith(":commit")).length, 1);
  assert.ok(!calls.some((c) => c.url.includes("/bundles")));
});
test("cannot halt a completed full release or wrong version", async () => {
  let mutated = false;
  await assert.rejects(
    setProductionRollout({
      credentialBase64,
      expectedVersionCode: "123",
      status: "halted",
      fetchImpl: async (url, options = {}) => {
        if (url.includes("oauth2"))
          return Response.json({ access_token: "test" });
        if (url.endsWith("/edits")) return Response.json({ id: "edit" });
        if (options.method === "PUT" || url.endsWith(":commit")) mutated = true;
        if (options.method === "DELETE")
          return new Response(null, { status: 204 });
        return Response.json({
          track: "production",
          releases: [
            {
              versionCodes: ["123"],
              status: "completed",
            },
          ],
        });
      },
    }),
    /cannot be reconciled/,
  );
  assert.equal(mutated, false);
});

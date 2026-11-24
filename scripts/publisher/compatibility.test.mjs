import assert from "node:assert/strict";
import { it } from "node:test";
import { compatible } from "./compatibility.mjs";
const producer = "a".repeat(40),
  connect = "b".repeat(40),
  // Revision the retired hosted provider's /ready is frozen at.
  frozen = "74869d0822543c9a4d4621d9c3ee40d6a79b6fd6";
const health = (body) => async (url, options) => {
  if (!url.startsWith("https://api.github.com/"))
    assert.equal(options.headers.Authorization, undefined);
  assert.equal(options.redirect, "error");
  assert.equal(options.headers["Cache-Control"], "no-store");
  if (url === "https://connect.mdbase.dev/health") return Response.json(body);
  assert.ok(url.includes(`/compare/${producer}...${body.revision}?`));
  return Response.json({ status: "ahead" });
};
it("requires producer ancestry in the live Connect revision only and sends GitHub token only to GitHub", async () => {
  const calls = [];
  const live = health({
    ok: true,
    environment: "production",
    revision: connect,
  });
  const fetchImpl = async (url, options) => {
    calls.push(url);
    assert.equal(
      options.headers.Authorization,
      url.startsWith("https://api.github.com/")
        ? "Bearer test-double"
        : undefined,
    );
    return live(url, options);
  };
  assert.equal(
    await compatible(producer, { fetchImpl, token: "test-double" }),
    true,
  );
  assert.deepEqual(calls, [
    "https://connect.mdbase.dev/health",
    `https://api.github.com/repos/mdbase-dev/mdbase-connect/compare/${producer}...${connect}?per_page=1`,
  ]);
  for (const [state, expected] of [
    ["identical", true],
    ["behind", false],
    ["diverged", false],
  ])
    assert.equal(
      await compatible(producer, {
        fetchImpl: async (url, options) =>
          url.includes("/compare/")
            ? Response.json({ status: state })
            : fetchImpl(url, options),
        token: "test-double",
      }),
      expected,
    );
  assert.equal(
    await compatible(producer, {
      fetchImpl: async () => {
        throw Error("private-payload");
      },
    }),
    false,
  );
});
it("accepts a producer newer than the frozen retired-provider revision when Connect is newer", async () => {
  const fetchImpl = async (url, options) => {
    if (url.includes("sync.mdbase.dev"))
      throw Error("retired provider must not be read");
    if (url.includes(`/compare/${producer}...${frozen}`))
      return Response.json({ status: "behind" });
    return health({ ok: true, environment: "production", revision: connect })(
      url,
      options,
    );
  };
  assert.equal(await compatible(producer, { fetchImpl }), true);
});
it("refuses unhealthy, non-production or malformed Connect revisions", async () => {
  for (const body of [
    { ok: false, environment: "production", revision: connect },
    { ok: true, environment: "staging", revision: connect },
    { ok: true, environment: "production", revision: "main" },
    { ok: true, environment: "production" },
  ])
    assert.equal(
      await compatible(producer, { fetchImpl: health(body) }),
      false,
    );
  assert.equal(
    await compatible(producer, {
      fetchImpl: async () => new Response("", { status: 503 }),
    }),
    false,
  );
});

import assert from "node:assert/strict";
import { it } from "node:test";
import { compatible } from "./compatibility.mjs";
const producer = "a".repeat(40),
  cp = "b".repeat(40),
  provider = "c".repeat(40);
it("requires producer ancestry in both live revisions and sends GitHub token only to GitHub", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    assert.equal(
      !!options.headers.Authorization,
      url.startsWith("https://api.github.com/"),
    );
    if (url.endsWith("/health"))
      return Response.json({
        ok: true,
        environment: "production",
        revision: cp,
      });
    if (url.endsWith("/ready"))
      return Response.json({
        status: "ready",
        provider: { revision: provider },
      });
    assert.ok(url.includes(producer + "..."));
    return Response.json({ status: "ahead" });
  };
  assert.equal(
    await compatible(producer, { fetchImpl, token: "test-double" }),
    true,
  );
  assert.equal(calls.length, 4);
  for (const state of ["behind", "diverged"])
    assert.equal(
      await compatible(producer, {
        fetchImpl: async (url, options) =>
          url.includes("/compare/")
            ? Response.json({ status: state })
            : fetchImpl(url, options),
        token: "test-double",
      }),
      false,
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

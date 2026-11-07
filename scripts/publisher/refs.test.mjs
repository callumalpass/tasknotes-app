import assert from "node:assert/strict";
import { it } from "node:test";
import { assertGreenSource } from "./refs.mjs";
const source = "a".repeat(40);
const good = {
  id: 1,
  run_attempt: 1,
  head_sha: source,
  head_branch: "main",
  event: "push",
  path: ".github/workflows/ci.yml",
  status: "completed",
  conclusion: "success",
};
it("publication independently requires exact latest successful main push CI, not a PR or another commit", async () => {
  const verify = (runs) =>
    assertGreenSource(source, {
      token: "fixture",
      fetchImpl: async (url, options) => {
        assert.ok(url.includes("head_sha=" + source));
        assert.equal(options.headers.Authorization, "Bearer fixture");
        return Response.json({ workflow_runs: runs });
      },
    });
  await verify([good]);
  for (const patch of [
    { head_sha: "b".repeat(40) },
    { event: "pull_request" },
    { head_branch: "release" },
    { path: ".github/workflows/other.yml" },
    { status: "in_progress" },
    { conclusion: "failure" },
  ])
    await assert.rejects(verify([{ ...good, ...patch }]), /exact-source-ci/);
  await assert.rejects(
    verify([good, { ...good, id: 2, conclusion: "failure" }]),
    /exact-source-ci/,
  );
  await assert.rejects(verify([]), /exact-source-ci/);
});

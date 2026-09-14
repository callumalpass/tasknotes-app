import test from "node:test";
import assert from "node:assert/strict";
import { resolveSourceRun } from "./app-store-source-run.mjs";

const repo = "callumalpass/tasknotes-app";
const run = {
  repository: { full_name: repo },
  head_repository: { full_name: repo },
  path: ".github/workflows/ios-release.yml",
  conclusion: "success",
  status: "completed",
  event: "workflow_dispatch",
  head_sha: "a".repeat(40),
  run_number: 14,
};
const artifact = { name: "tasknotes-ios-1.0.3-14", expired: false };

test("resolves exact iOS version/build from trusted source artifact", () => {
  assert.deepEqual(resolveSourceRun(run, [artifact], repo), {
    version: "1.0.3",
    build: "14",
    sha: run.head_sha,
  });
});
for (const patch of [
  { conclusion: "failure" },
  { status: "in_progress" },
  { event: "pull_request" },
  { path: ".github/workflows/other.yml" },
  { head_repository: { full_name: "fork/repo" } },
  { head_sha: "--help" },
  { run_number: -1 },
]) {
  test(`rejects untrusted source ${JSON.stringify(patch)}`, () => {
    assert.throws(() =>
      resolveSourceRun({ ...run, ...patch }, [artifact], repo),
    );
  });
}
for (const artifacts of [
  [],
  [artifact, artifact],
  [{ ...artifact, expired: true }],
  [{ ...artifact, name: "tasknotes-ios-1.0.3-15" }],
  [{ ...artifact, name: "tasknotes-ios-../secret-14" }],
]) {
  test(`rejects missing, ambiguous or mismatched artifacts: ${JSON.stringify(artifacts)}`, () => {
    assert.throws(() => resolveSourceRun(run, artifacts, repo));
  });
}

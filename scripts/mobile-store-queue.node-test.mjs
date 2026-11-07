import test from "node:test";
import assert from "node:assert/strict";
import { newestSourceRuns, appleQueueBlock } from "./mobile-store-queue.mjs";
test("newest main source order wins over build time and failed newer runs", () => {
  const runs = [
    { id: 1, head_sha: "b", head_branch: "main" },
    { id: 2, head_sha: "a", head_branch: "main" },
    { id: 3, head_sha: "b", head_branch: "feature" },
    { id: 4, head_sha: "b", head_branch: "main", conclusion: "failure" },
  ];
  assert.deepEqual(
    newestSourceRuns([{ sha: "b" }, { sha: "a" }], runs, "ios").map(
      (r) => r.id,
    ),
    [4, 2],
  );
});
test("Android debug main runs cannot mask signed tag candidates", () => {
  const runs = [
    { id: 1, head_sha: "a", head_branch: "android-v1.0.13" },
    { id: 2, head_sha: "a", head_branch: "main" },
  ];
  assert.deepEqual(
    newestSourceRuns([{ sha: "a" }], runs, "android").map((r) => r.id),
    [1],
  );
});

test("reviews wait; rejections stop only the Apple line", () => {
  assert.equal(appleQueueBlock([{ state: "READY_FOR_SALE" }]), null);
  assert.equal(
    appleQueueBlock([{ state: "IN_REVIEW" }]),
    "earlier-store-version-in-flight",
  );
  assert.equal(appleQueueBlock([{ state: "REJECTED" }]), "store-rejected");
});

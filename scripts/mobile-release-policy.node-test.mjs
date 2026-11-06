import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCooldown,
  isReadOnlyReceipt,
  assertWasmProof,
  latestExactGreen,
  LINES,
} from "./mobile-release-policy.mjs";

test("cooldown exempts only verified dry attempts; unknown writes and in-flight block", () => {
  const now = Date.now();
  const previous = {
    id: 1,
    status: "completed",
    created_at: new Date(now - 1000).toISOString(),
  };
  assert.throws(() => assertCooldown([previous], 2, now), /24-hour/);
  assert.throws(
    () => assertCooldown([{ ...previous, created_at: "bad" }], 2, now),
    /time-unavailable/,
  );
  assert.throws(
    () => assertCooldown([{ ...previous, status: "in_progress" }], 2, now),
    /in-flight/,
  );
  assert.doesNotThrow(() =>
    assertCooldown(
      [{ ...previous, created_at: new Date(now - 86400000).toISOString() }],
      2,
      now,
    ),
  );
  assert.doesNotThrow(() => assertCooldown([previous], 1, now));
  assert.doesNotThrow(() =>
    assertCooldown([{ ...previous, verifiedReadOnly: true }], 2, now),
  );
  assert.throws(
    () =>
      assertCooldown(
        [{ ...previous, verifiedReadOnly: true, status: "in_progress" }],
        2,
        now,
      ),
    /in-flight/,
  );
});

test("read-only receipts bind exact protected first attempt and cannot exempt a real submit", () => {
  const run = {
    id: 123,
    head_sha: "a".repeat(40),
    run_attempt: 1,
    event: "workflow_dispatch",
    head_branch: "main",
    path: ".github/workflows/app-store-submit.yml",
  };
  const receipt = {
    schema: "tasknotes/mobile-read-only-attempt/1",
    runId: 123,
    source: run.head_sha,
    attempt: 1,
    platform: "ios",
    submit: false,
    release: false,
  };
  assert.equal(isReadOnlyReceipt(receipt, run, "ios"), true);
  for (const change of [
    { runId: 124 },
    { source: "b".repeat(40) },
    { attempt: 2 },
    { platform: "android" },
    { submit: true },
    { release: true },
    { submit: "false" },
    { schema: "unknown" },
  ])
    assert.equal(
      isReadOnlyReceipt({ ...receipt, ...change }, run, "ios"),
      false,
    );
  for (const change of [
    { run_attempt: 2 },
    { head_branch: "other" },
    { event: "pull_request" },
    { path: ".github/workflows/other.yml" },
  ])
    assert.equal(
      isReadOnlyReceipt(receipt, { ...run, ...change }, "ios"),
      false,
    );
});

test("exact CI cannot borrow success from an old attempt or other event", () => {
  const run = {
    id: 1,
    head_sha: "a",
    event: "push",
    head_branch: "main",
    path: ".github/workflows/ios.yml",
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
  };
  assert.equal(latestExactGreen([run], "a", "ios.yml"), true);
  assert.equal(
    latestExactGreen(
      [run, { ...run, run_attempt: 2, conclusion: "failure" }],
      "a",
      "ios.yml",
    ),
    false,
  );
  assert.equal(
    latestExactGreen([{ ...run, event: "pull_request" }], "a", "ios.yml"),
    false,
  );
});

test("wasm proof binds signed artifact digest, source, platform and build run", () => {
  const run = { id: 123 };
  const artifact = { id: 456, digest: "sha256:" + "a".repeat(64) };
  const proof = {
    schema: "tasknotes/mobile-wasm-qualification/1",
    platform: "ios",
    sourceSha: "b".repeat(40),
    sourceRunId: run.id,
    buildArtifactId: artifact.id,
    buildArtifactDigest: artifact.digest,
    wasmRoute: "passed",
    checks: {
      "runtime-initialized": true,
      "sqlite-open-query-write-reopen": true,
      "task-create-edit-reload": true,
    },
  };
  assert.doesNotThrow(() =>
    assertWasmProof(proof, proof.sourceSha, run, artifact, "ios"),
  );
  for (const change of [
    { sourceRunId: 124 },
    { buildArtifactId: 457 },
    { buildArtifactDigest: "sha256:" + "c".repeat(64) },
    { wasmRoute: "not-run" },
    { checks: {} },
    { platform: "android" },
  ])
    assert.throws(
      () =>
        assertWasmProof(
          { ...proof, ...change },
          proof.sourceSha,
          run,
          artifact,
          "ios",
        ),
      /qualification-required/,
    );
});

test("store holds cannot address a server line or each other", () => {
  assert.deepEqual(LINES, {
    android: "tasknotes-google-play",
    ios: "tasknotes-app-store",
  });
});

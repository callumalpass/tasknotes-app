import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCooldown,
  assertWasmProof,
  latestExactGreen,
  LINES,
} from "./mobile-release-policy.mjs";

test("cooldown counts failed and dry attempts and blocks in-flight", () => {
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

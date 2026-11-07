import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSameRunArtifact,
  assertArchiveDigest,
  signedAndroidProof,
  sha256,
} from "./android-signed-artifact.mjs";

function fixture() {
  const sha = "a".repeat(40);
  const context = {
    repository: "callumalpass/tasknotes-app",
    event: "push",
    ref: "refs/tags/android-v1.0.13",
    attempt: 1,
    sha,
    runId: 100,
  };
  const run = {
    id: 100,
    head_sha: sha,
    run_attempt: 1,
    event: "push",
    head_branch: "android-v1.0.13",
    path: ".github/workflows/android.yml",
    repository: { full_name: context.repository, id: 10 },
    head_repository: { full_name: context.repository, id: 10 },
  };
  const bytes = Buffer.from("retained archive bytes");
  const artifact = {
    id: 200,
    name: "tasknotes-android-android-v1.0.13",
    expired: false,
    digest: `sha256:${sha256(bytes)}`,
    workflow_run: {
      id: 100,
      head_sha: sha,
      repository_id: 10,
      head_repository_id: 10,
    },
  };
  return { context, run, artifact, bytes, version: "1.0.13", kind: "build" };
}

test("binds an exact retained artifact to this tag build, repository and attempt", () => {
  assertSameRunArtifact(fixture());
  const f = fixture();
  f.artifact.name = `tasknotes-android-test-host-${f.context.sha}`;
  f.kind = "host";
  assertSameRunArtifact(f);
});

for (const [object, field, value] of [
  ["context", "repository", "another/repository"],
  ["context", "event", "pull_request"],
  ["context", "ref", "refs/heads/main"],
  ["context", "attempt", 2],
  ["run", "id", 101],
  ["run", "head_sha", "b".repeat(40)],
  ["run", "run_attempt", 2],
  ["run", "event", "workflow_dispatch"],
  ["run", "path", ".github/workflows/ios.yml"],
  ["run", "head_branch", "main"],
  ["run", "repository", { full_name: "another/repository", id: 10 }],
  ["run", "head_repository", { full_name: "another/repository", id: 10 }],
  ["artifact", "id", 0],
  ["artifact", "expired", true],
  ["artifact", "digest", null],
  ["artifact", "name", "tasknotes-android-debug"],
]) {
  test(`refuses mismatched ${object}.${field}`, () => {
    const f = fixture();
    f[object][field] = value;
    assert.throws(() => assertSameRunArtifact(f));
  });
}
for (const field of ["id", "head_sha", "repository_id", "head_repository_id"]) {
  test(`refuses a foreign retained artifact workflow_run.${field}`, () => {
    const f = fixture();
    f.artifact.workflow_run[field] = "wrong";
    assert.throws(() => assertSameRunArtifact(f));
  });
}

test("checks actual archive bytes against both API and upload output", () => {
  const { bytes, artifact } = fixture();
  assertArchiveDigest(bytes, artifact, sha256(bytes));
  assert.throws(() =>
    assertArchiveDigest(Buffer.from("tampered"), artifact, sha256(bytes)),
  );
  assert.throws(() => assertArchiveDigest(bytes, artifact, "b".repeat(64)));
});

test("proof is accepted by unchanged consumer policy only after all exercises and cleanup", () => {
  const f = fixture();
  const result = {
    status: "passed",
    checks: {
      "runtime-initialized": true,
      "sqlite-open-query-write-reopen": true,
      "task-create-edit-reload": true,
    },
    cleanup: "owned-task-deleted-and-installation-access-revoked",
    environment: "production",
  };
  const args = {
    ...f,
    result,
    apkSha256: "c".repeat(64),
    aabSha256: "d".repeat(64),
    host: { id: 201, digest: f.artifact.digest },
  };
  const proof = signedAndroidProof(args);
  assert.equal(proof.buildArtifactId, f.artifact.id);
  assert.equal(proof.buildArtifactDigest, f.artifact.digest);
  assert.throws(() =>
    signedAndroidProof({ ...args, result: { ...result, status: "failed" } }),
  );
  assert.throws(() =>
    signedAndroidProof({ ...args, result: { ...result, cleanup: "unknown" } }),
  );
  for (const check of Object.keys(result.checks))
    assert.throws(() =>
      signedAndroidProof({
        ...args,
        result: { ...result, checks: { ...result.checks, [check]: false } },
      }),
    );
});

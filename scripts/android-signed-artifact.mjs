import { createHash } from "node:crypto";
import {
  assertWasmProof,
  requirePolicy,
  REPO,
} from "./mobile-release-policy.mjs";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export function assertSameRunArtifact({
  run,
  artifact,
  context,
  version,
  kind,
}) {
  const name =
    kind === "build"
      ? `tasknotes-android-android-v${version}`
      : `tasknotes-android-test-host-${context.sha}`;
  requirePolicy(
    ["build", "host"].includes(kind) &&
      context.repository === REPO &&
      context.event === "push" &&
      context.ref === `refs/tags/android-v${version}` &&
      context.attempt === 1 &&
      /^[a-f0-9]{40}$/.test(context.sha) &&
      Number.isSafeInteger(context.runId) &&
      context.runId > 0 &&
      run.id === context.runId &&
      run.head_sha === context.sha &&
      run.run_attempt === context.attempt &&
      run.event === context.event &&
      run.head_branch === `android-v${version}` &&
      run.path === ".github/workflows/android.yml" &&
      run.repository?.full_name === REPO &&
      run.head_repository?.full_name === REPO &&
      artifact.workflow_run?.id === run.id &&
      artifact.workflow_run?.head_sha === run.head_sha &&
      artifact.workflow_run?.repository_id === run.repository.id &&
      artifact.workflow_run?.head_repository_id === run.head_repository.id &&
      artifact.name === name &&
      artifact.expired === false &&
      Number.isSafeInteger(artifact.id) &&
      artifact.id > 0 &&
      /^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? ""),
    "same-run-signed-artifact-required",
  );
}

export function assertArchiveDigest(bytes, artifact, uploadDigest) {
  // Compare independently downloaded retained bytes, API metadata and this
  // run's upload output. A successful download or matching filename is not proof.
  requirePolicy(
    artifact.digest === `sha256:${uploadDigest}` &&
      artifact.digest === `sha256:${sha256(bytes)}`,
    "signed-artifact-archive-digest-mismatch",
  );
}

export function signedAndroidProof({
  context,
  run,
  artifact,
  result,
  apkSha256,
  aabSha256,
  host,
}) {
  requirePolicy(
    result.status === "passed" &&
      result.cleanup === "owned-task-deleted-and-installation-access-revoked" &&
      /^[a-f0-9]{64}$/.test(apkSha256) &&
      /^[a-f0-9]{64}$/.test(aabSha256),
    "exercised-signed-native-journey-required",
  );
  const proof = {
    schema: "tasknotes/mobile-wasm-qualification/1",
    platform: "android",
    sourceSha: context.sha,
    sourceRunId: run.id,
    sourceRunAttempt: run.run_attempt,
    buildArtifactId: artifact.id,
    buildArtifactDigest: artifact.digest,
    wasmRoute: "passed",
    checks: result.checks,
    cleanup: result.cleanup,
    installedApkSha256: apkSha256,
    aabSha256,
    testHostArtifactId: host.id,
    testHostArtifactDigest: host.digest,
    environment: result.environment,
    serverRevision: result.serverRevision,
  };
  // The existing consumer policy remains the authority; do not duplicate a
  // more permissive acceptance rule in the producer.
  assertWasmProof(proof, context.sha, run, artifact, "android");
  return proof;
}

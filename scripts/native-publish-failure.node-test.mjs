import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { upload } from "./native-publisher-upload.mjs";
import { recordBuildFailure } from "./native-build-failure.mjs";
for (const [key, phase] of [
  ["NATIVE_ORIGINALS_OUTCOME", "originals"],
  ["NATIVE_INSTALLED_OUTCOME", "installed-members"],
  ["NATIVE_PREPARE_OUTCOME", "build-and-inventory"],
]) {
  test(`unprivileged ${phase} refusal retains only public failed receipt`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "tn-build-failure-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const environment = {
      RUNNER_TEMP: directory,
      NATIVE_FAILURE_PATH: join(directory, "failure"),
      NATIVE_SOURCE_SHA: "a".repeat(40),
      NATIVE_TARGET: "staging",
      GITHUB_REPOSITORY: "unit-test/tasknotes",
      GITHUB_RUN_ID: "11",
      GITHUB_RUN_ATTEMPT: "2",
      [key]: "failure",
      GITHUB_TOKEN: "private-unit-canary",
      UNRELATED_CONTEXT: "private-unit-canary",
    };
    const receipt = await recordBuildFailure(environment);
    assert.deepEqual(
      await json(environment.NATIVE_FAILURE_PATH, "receipt.json"),
      receipt,
    );
    assert.equal(receipt.status, "failed");
    assert.equal(receipt.phase, phase);
    assert.deepEqual(receipt.source, {
      requestedSha: "a".repeat(40),
      tree: null,
    });
    assert.deepEqual(receipt.run, {
      repository: "unit-test/tasknotes",
      id: "11",
      attempt: "2",
    });
    assert.equal(receipt.deployment, null);
    assert.doesNotMatch(
      JSON.stringify(receipt),
      /private-unit-canary|prepared|artifact|sdkTrust|authenticated/,
    );
  });
}
const sha = "a".repeat(40);
const json = (directory, name) =>
  readFile(join(directory, name), "utf8").then(JSON.parse);
for (const scenario of [
  "initial-attempt",
  "run-lookup",
  "runAfter-lookup",
  "after-attempt",
]) {
  test(`fetched metadata retained before next fallible operation: ${scenario}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "tn-metadata-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const evidence = join(directory, "evidence");
    const bytes = Buffer.from(
      "not a ZIP: extraction must not precede after/runAfter validation",
    );
    const digest = createHash("sha256").update(bytes).digest("hex");
    const metadata = {
      id: 42,
      digest: `sha256:${digest}`,
      expired: false,
      name: `tasknotes-native-build-staging-${sha}-11-2`,
      workflow_run: {
        id: 11,
        head_sha: sha,
        repository_id: 7,
        head_repository_id: 7,
        head_branch: "release/native-staging",
      },
    };
    const run = {
      id: 11,
      run_attempt: 2,
      head_sha: sha,
      event: "workflow_dispatch",
      head_branch: "release/native-staging",
      repository: { id: 7, full_name: "unit-test/tasknotes" },
    };
    let metadataCalls = 0,
      runCalls = 0,
      zipCalls = 0;
    const savedBeforeNext = [];
    t.mock.method(globalThis, "fetch", async (address) => {
      const url = String(address);
      if (url.endsWith("/zip")) {
        zipCalls++;
        savedBeforeNext.push(
          await json(evidence, "run.json").then(
            () => true,
            () => false,
          ),
        );
        return new Response(null, {
          status: 302,
          headers: { location: "https://example.blob.core.windows.net/unit" },
        });
      }
      if (url.includes(".blob.core.windows.net")) return new Response(bytes);
      if (url.includes("/artifacts/")) {
        metadataCalls++;
        return Response.json(metadata);
      }
      runCalls++;
      const previous = runCalls === 1 ? "before" : "after";
      savedBeforeNext.push(
        await json(evidence, `${previous}.json`).then(
          () => true,
          () => false,
        ),
      );
      if (
        (scenario === "run-lookup" && runCalls === 1) ||
        (scenario === "runAfter-lookup" && runCalls === 2)
      )
        throw new Error("opaque-private-lookup-detail-MUST-NOT-be-retained");
      return Response.json({
        ...run,
        run_attempt:
          (scenario === "initial-attempt" && runCalls === 1) ||
          (scenario === "after-attempt" && runCalls === 2)
            ? 3
            : 2,
      });
    });
    await assert.rejects(
      upload(
        {
          RUNNER_TEMP: directory,
          NATIVE_EVIDENCE_PATH: evidence,
          GITHUB_EVENT_NAME: "workflow_dispatch",
          NATIVE_TARGET: "staging",
          NATIVE_SOURCE_SHA: sha,
          GITHUB_SHA: sha,
          GITHUB_REF: "refs/heads/release/native-staging",
          GITHUB_REPOSITORY: "unit-test/tasknotes",
          GITHUB_RUN_ID: "11",
          GITHUB_RUN_ATTEMPT: "2",
          NATIVE_ARTIFACT_ID: "42",
          NATIVE_ARTIFACT_DIGEST: digest,
        },
        { checkout: async () => {}, intake: async () => ({}) },
      ),
    );
    assert.ok(savedBeforeNext.length > 0);
    assert.ok(
      savedBeforeNext.every(Boolean),
      "each fetched metadata response must already be on disk before next lookup",
    );
    assert.deepEqual(await json(evidence, "before.json"), metadata);
    const receipt = await json(evidence, "receipt.json");
    assert.equal(receipt.status, "failed");
    assert.equal(receipt.deployment, null);
    assert.doesNotMatch(receipt.failure, /opaque-private/);
    const trace = await json(evidence, "artifact-fetch-evidence.json");
    if (scenario === "initial-attempt") {
      assert.equal((await json(evidence, "run.json")).run_attempt, 3);
      assert.equal(trace.failureStage, "validate-before");
      assert.equal(zipCalls, 0);
    } else if (scenario === "run-lookup") {
      assert.equal(trace.failureStage, "fetch-run");
      assert.equal(zipCalls, 0);
    } else {
      assert.equal(metadataCalls, 2);
      assert.deepEqual(await json(evidence, "after.json"), metadata);
      assert.equal(zipCalls, 1);
      if (scenario === "runAfter-lookup")
        assert.equal(trace.failureStage, "fetch-runAfter");
      else {
        assert.equal((await json(evidence, "runAfter.json")).run_attempt, 3);
        assert.equal(trace.failureStage, "validate-after");
      }
    }
    assert.doesNotMatch(JSON.stringify(trace), /opaque-private/);
  });
}
test("unprivileged build failures have a separate failure-only artifact, never qualified outputs", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/deploy-pages.yml", import.meta.url),
    "utf8",
  );
  const build = workflow
    .split("  native-build:")[1]
    .split("  native-publish:")[0];
  assert.match(build, /native-build-failure.mjs/);
  assert.match(build, /name: tasknotes-native-build-failure-/);
  const failure = build.split(
    "- name: Record public unprivileged build failure",
  )[1];
  assert.ok(failure);
  assert.equal((failure.match(/if: failure\(\)/g) ?? []).length, 2);
  assert.doesNotMatch(
    failure,
    /id: artifact|GITHUB_OUTPUT|artifact-digest|\/dist|toJSON|secrets\./,
  );
  assert.match(build, /id: artifact\s+if: success\(\)/);
  assert.match(
    workflow.split("  native-publish:")[1],
    /needs.native-build.result == 'success'/,
  );
});

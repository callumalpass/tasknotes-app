import { appendFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPO,
  gh,
  requirePolicy,
  qualifyCommit,
  qualifySource,
  assertLinesOpen,
  artifactJson,
  storeLine,
} from "./mobile-release-policy.mjs";
import { readAppleLive, playReviewBlock } from "./store-status.mjs";
import { createStatusClient } from "./app-store-status.mjs";

export const platforms = { "google-play": "android", "app-store": "ios" };
export function appleQueueBlock(versions) {
  if (
    versions.some((version) =>
      ["REJECTED", "METADATA_REJECTED", "DEVELOPER_REJECTED"].includes(
        version.state,
      ),
    )
  )
    return "store-rejected";
  if (
    versions.some(
      (version) =>
        ![
          "READY_FOR_SALE",
          "READY_FOR_DISTRIBUTION",
          "REPLACED_WITH_NEW_VERSION",
          "REMOVED_FROM_SALE",
          "DEVELOPER_REMOVED_FROM_SALE",
        ].includes(version.state),
    )
  )
    return "earlier-store-version-in-flight";
  return null;
}
export function nextVersion(packageVersion, liveVersion) {
  requirePolicy(
    /^\d+\.\d+\.\d+$/.test(packageVersion),
    "numeric-package-version-required",
  );
  if (!liveVersion) return packageVersion;
  requirePolicy(
    /^\d+\.\d+\.\d+$/.test(liveVersion),
    "numeric-store-version-required",
  );
  const compare = (left, right) => {
    const first = left.split(".").map(Number),
      second = right.split(".").map(Number);
    return first[0] - second[0] || first[1] - second[1] || first[2] - second[2];
  };
  const parts = liveVersion.split(".").map(Number);
  parts[2] += 1;
  return compare(packageVersion, liveVersion) > 0
    ? packageVersion
    : parts.join(".");
}
export function context(workflow) {
  requirePolicy(
    process.env.GITHUB_REPOSITORY === REPO &&
      process.env.GITHUB_REF === "refs/heads/main" &&
      process.env.GITHUB_RUN_ATTEMPT === "1" &&
      process.env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      process.env.GITHUB_WORKFLOW_REF ===
        `${REPO}/.github/workflows/${workflow}@refs/heads/main`,
    "protected-store-context-required",
  );
}
export async function dispatch(
  workflow,
  inputs,
  save,
  transport = gh,
  wait = (delay) => new Promise((done) => setTimeout(done, delay)),
) {
  await save({
    boundary: workflow,
    boundary_outcome: "dispatch-unknown",
    child_run_id: null,
  });
  const response = transport(
    `repos/${REPO}/actions/workflows/${workflow}/dispatches`,
    { body: { ref: "main", inputs, return_run_details: true } },
  );
  const runId = response.workflow_run_id;
  requirePolicy(
    Number.isSafeInteger(runId) && runId > 0,
    "store-dispatch-identity-unknown",
  );
  await save({ child_run_id: runId, boundary_outcome: "waiting" });
  for (let attempt = 0; attempt < 600; attempt++) {
    const run = transport(`repos/${REPO}/actions/runs/${runId}`);
    requirePolicy(
      run.id === runId &&
        run.path === `.github/workflows/${workflow}` &&
        run.head_branch === "main" &&
        run.event === "workflow_dispatch" &&
        run.run_attempt === 1,
      "store-run-binding-required",
    );
    if (run.status === "completed") {
      requirePolicy(
        run.conclusion === "success",
        "store-build-or-publication-failed",
      );
      await save({ boundary_outcome: "success" });
      return runId;
    }
    await wait(15000);
  }
  throw new Error("store-outcome-unknown");
}
async function previousSubmission(target, source, liveVersion) {
  const pages = gh(
    `repos/${REPO}/actions/workflows/publish-tasknotes-store.yml/runs?branch=main&event=workflow_dispatch&per_page=100`,
    { pages: true },
  );
  for (const run of pages.flatMap((page) => page.workflow_runs)) {
    if (
      run.status !== "completed" ||
      run.conclusion !== "success" ||
      run.run_attempt !== 1 ||
      run.path !== ".github/workflows/publish-tasknotes-store.yml" ||
      run.head_branch !== "main" ||
      run.event !== "workflow_dispatch"
    )
      continue;
    const name = `tasknotes-store-${target}-${run.id}`;
    const artifacts = gh(
      `repos/${REPO}/actions/runs/${run.id}/artifacts?per_page=100`,
    ).artifacts;
    if (
      !artifacts.some((artifact) => artifact.name === name && !artifact.expired)
    )
      continue;
    const receipt = await artifactJson(run.id, name, "store-cd-result.json");
    if (
      receipt.schema === "tasknotes/store-cd/1" &&
      receipt.run_id === run.id &&
      receipt.target === target &&
      receipt.source === source &&
      receipt.version === liveVersion &&
      ["submitted", "already-live"].includes(receipt.outcome)
    )
      return true;
  }
  return false;
}
export async function releaseTarget({ target, source, runId, save, services }) {
  const platform = platforms[target];
  requirePolicy(platform, "unknown-store-target");
  await services.lines(platform);
  const status = await services.status(platform);
  const blocker =
    platform === "android"
      ? playReviewBlock(status)
      : appleQueueBlock(status.versions);
  if (blocker === "earlier-store-version-in-flight")
    return save({ outcome: "pending-review" });
  requirePolicy(!blocker, blocker);
  const pkg = await services.commit(source);
  if (await services.previous(target, source, status.liveVersion))
    return save({ outcome: "already-live", version: status.liveVersion });
  const version = nextVersion(pkg.version, status.liveVersion);
  await save({ version, outcome: "building" });
  const buildWorkflow =
    platform === "android" ? "android.yml" : "ios-release.yml";
  const sourceRunId = await services.dispatch(
    buildWorkflow,
    { source_sha: source, version },
    save,
  );
  const qualified = await services.qualify(platform, sourceRunId);
  requirePolicy(
    qualified.source === source && qualified.version === version,
    "store-build-candidate-changed",
  );
  await save({ source_run_id: sourceRunId, build: qualified.build });
  await services.lines(platform);
  const workflow =
    platform === "android"
      ? "google-play-production.yml"
      : "app-store-submit.yml";
  const publishRunId = await services.dispatch(
    workflow,
    { source_run_id: String(sourceRunId) },
    save,
  );
  const outcome = await services.result(publishRunId, source);
  requirePolicy(
    ["submitted", "pending-review", "production-contract-wait"].includes(
      outcome,
    ),
    "store-publication-receipt-required",
  );
  await save({ outcome, run_id: runId });
}
async function status(platform, save) {
  if (platform === "android") {
    const runId = await dispatch(
      "store-status.yml",
      { platform: "android" },
      save,
    );
    return artifactJson(
      runId,
      "store-status-android",
      "store-status-android.json",
    );
  }
  return readAppleLive(
    createStatusClient({
      keyId: process.env.APP_STORE_CONNECT_KEY_ID,
      issuerId: process.env.APP_STORE_CONNECT_ISSUER_ID,
      privateKey: Buffer.from(
        process.env.APP_STORE_CONNECT_PRIVATE_KEY_BASE64 ?? "",
        "base64",
      ).toString("utf8"),
    }),
  );
}
async function main() {
  context("publish-tasknotes-store.yml");
  const target = process.env.STORE_TARGET,
    source = process.env.SOURCE_SHA;
  const receipt = {
    schema: "tasknotes/store-cd/1",
    target,
    source,
    run_id: Number(process.env.GITHUB_RUN_ID),
    outcome: "qualifying",
  };
  const save = async (value) => {
    Object.assign(receipt, value);
    await writeFile(
      "store-cd-result.json",
      JSON.stringify(receipt, null, 2) + "\n",
    );
  };
  await save({});
  try {
    await releaseTarget({
      target,
      source,
      runId: receipt.run_id,
      save,
      services: {
        lines: assertLinesOpen,
        status: (platform) => status(platform, save),
        commit: qualifyCommit,
        previous: previousSubmission,
        dispatch,
        qualify: qualifySource,
        result: async (runId, source) => {
          const result = await artifactJson(
            runId,
            "store-target-result",
            "store-target-result.json",
          );
          requirePolicy(
            result.source === source,
            "store-publication-source-mismatch",
          );
          return result.outcome;
        },
      },
    });
  } catch (error) {
    const reason = /^[a-z0-9-]+$/.test(error.message)
      ? error.message
      : "store-evidence-unavailable";
    await save({ outcome: "stopped", reason });
    try {
      await storeLine(
        platforms[target],
        "stop",
        reason === "store-rejected" ? reason : "app-outcome-unknown",
      );
    } catch {
      await save({ hold_write_failed: true });
    }
    throw new Error(
      "Store target stopped; inspect its bounded attempt record",
      {
        cause: error,
      },
    );
  }
}
export async function prepareBuild(platform) {
  context(platform === "android" ? "android.yml" : "ios-release.yml");
  await assertLinesOpen(platform);
  const source = process.env.SOURCE_SHA,
    version = process.env.STORE_VERSION;
  await qualifyCommit(source);
  requirePolicy(
    /^\d+\.\d+\.\d+$/.test(version ?? ""),
    "numeric-store-version-required",
  );
  const binding = {
    source,
    version,
    platform,
    build: Number(process.env.GITHUB_RUN_NUMBER),
    runId: Number(process.env.GITHUB_RUN_ID),
  };
  await writeFile("mobile-build-source.json", JSON.stringify(binding) + "\n");
  await appendFile(
    process.env.GITHUB_ENV,
    `TASKNOTES_STORE_SOURCE=${source}\nTASKNOTES_STORE_VERSION=${version}\n`,
  );
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const operation =
    process.argv[2] === "build" ? () => prepareBuild(process.argv[3]) : main;
  operation().catch(() => {
    console.error("Store CD refused; inspect the bounded outcome.");
    process.exitCode = 1;
  });
}

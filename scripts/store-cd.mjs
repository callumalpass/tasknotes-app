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
import { androidVersionCode } from "./publish-google-play.mjs";

export const platforms = { "google-play": "android", "app-store": "ios" };
// Mirrors mdbase-dev/mdbase-cloud-ops bin/lib/cd_retry.py STORE_INFRASTRUCTURE_REASONS at 224c0b0e7ca3bc7952fd468f16ffed08b7030c62.
export const storeInfrastructureReasons = Object.freeze([
  "release-evidence-unavailable",
  "npm-evidence-unavailable",
  "store-line-outcome-unknown",
  "store-line-read-timeout",
  "store-outcome-unknown",
  "play-release-lifecycle-observer-unavailable",
  "store-observer-unavailable",
  "store-status-observer-unavailable",
  "store-status-transport",
  "store-status-transport-failed",
  "store-status-transport-unavailable",
  "store-status-timeout",
  "store-status-observer-timeout",
]);
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
    ...(workflow === "store-status.yml" ? {} : { write_started: true }),
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
  let consecutiveReadFailures = 0;
  for (let attempt = 0; attempt < 600; attempt++) {
    let run;
    try {
      run = transport(`repos/${REPO}/actions/runs/${runId}`);
    } catch (error) {
      if (++consecutiveReadFailures >= 8) throw error;
      await wait(15000);
      continue;
    }
    consecutiveReadFailures = 0;
    requirePolicy(
      run.id === runId &&
        run.path === `.github/workflows/${workflow}` &&
        run.head_branch === "main" &&
        run.event === "workflow_dispatch" &&
        run.run_attempt === 1,
      "store-run-binding-required",
    );
    if (run.status === "completed") {
      await save({
        boundary_outcome: run.conclusion === "success" ? "success" : "failed",
      });
      requirePolicy(
        run.conclusion === "success",
        "store-build-or-publication-failed",
      );
      return runId;
    }
    await wait(15000);
  }
  throw new Error("store-outcome-unknown");
}
export async function previousSubmission(
  target,
  source,
  liveVersion,
  transport = gh,
  readArtifact = artifactJson,
) {
  return findSubmission(
    target,
    (receipt) =>
      receipt.source === source &&
      (liveVersion === undefined
        ? submittedBuild(receipt)
        : receipt.version === liveVersion),
    transport,
    readArtifact,
  );
}
function submittedBuild(receipt) {
  return (
    receipt.outcome === "submitted" &&
    /^[a-f0-9]{40}$/.test(receipt.source ?? "") &&
    /^\d+\.\d+\.\d+$/.test(receipt.version ?? "") &&
    Number.isSafeInteger(receipt.source_run_id) &&
    receipt.source_run_id > 0 &&
    Number.isSafeInteger(receipt.build) &&
    receipt.build > 0
  );
}
export function newestProductionRelease(tracks) {
  if (!Array.isArray(tracks)) return null;
  const production = tracks.filter((track) => track?.track === "production");
  if (production.length !== 1) return null;
  const releases = production[0].releases;
  if (!Array.isArray(releases) || !releases.length) return null;
  const candidates = [];
  for (const release of releases) {
    if (
      !Array.isArray(release?.versionCodes) ||
      !release.versionCodes.length ||
      !release.versionCodes.every(
        (code) =>
          typeof code === "string" &&
          /^[1-9]\d*$/.test(code) &&
          Number.isSafeInteger(Number(code)),
      )
    )
      return null;
    candidates.push({
      release,
      versionCode: Math.max(...release.versionCodes.map(Number)),
    });
  }
  candidates.sort((left, right) => right.versionCode - left.versionCode);
  const newest = candidates[0];
  if (
    newest.release.status !== "completed" ||
    candidates[1]?.versionCode === newest.versionCode
  )
    return null;
  return { name: newest.release.name, versionCode: newest.versionCode };
}
export async function previousPlaySubmission(
  release,
  transport = gh,
  readArtifact = artifactJson,
  versionCode = androidVersionCode,
) {
  return findSubmission(
    "google-play",
    (receipt) =>
      submittedBuild(receipt) &&
      release.name === `TaskNotes ${receipt.version}` &&
      release.versionCode === versionCode(receipt.build),
    transport,
    readArtifact,
  );
}
async function findSubmission(target, accepts, transport, readArtifact) {
  const pages = transport(
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
    const artifacts = transport(
      `repos/${REPO}/actions/runs/${run.id}/artifacts?per_page=100`,
    ).artifacts;
    if (
      !artifacts.some((artifact) => artifact.name === name && !artifact.expired)
    )
      continue;
    const receipt = await readArtifact(run.id, name, "store-cd-result.json");
    if (
      receipt.schema === "tasknotes/store-cd/1" &&
      receipt.run_id === run.id &&
      receipt.target === target &&
      accepts(receipt) &&
      ["submitted", "already-live"].includes(receipt.outcome)
    )
      return receipt;
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
  if (
    blocker === "play-release-lifecycle-observer-unavailable" &&
    status.review?.available === false
  ) {
    const release = newestProductionRelease(status.tracks);
    const submitted = release && (await services.previousPlay(release));
    if (submitted) {
      const qualified = await services.qualify(
        "android",
        submitted.source_run_id,
      );
      requirePolicy(
        qualified.source === submitted.source &&
          qualified.version === submitted.version &&
          qualified.build === submitted.build,
        "store-build-candidate-changed",
      );
      const versionCode = services.versionCode(qualified.build);
      if (
        release.name === `TaskNotes ${qualified.version}` &&
        release.versionCode === versionCode
      )
        return save({
          outcome: "pending-review-unobservable",
          write_started: false,
          version: qualified.version,
          source_run_id: submitted.source_run_id,
          build: qualified.build,
          pending_source: submitted.source,
        });
    }
  }
  requirePolicy(!blocker, blocker);
  const pkg = await services.commit(source, platform);
  if (await services.previous(target, source, status.liveVersion))
    return save({ outcome: "already-live", version: status.liveVersion });
  const version = nextVersion(pkg.version, status.liveVersion);
  await save({ version, outcome: "building", write_started: true });
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
  if (platform === "android") await save({ write_started: false });
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
    [
      "submitted",
      "pending-review",
      "pending-review-unobservable",
      "production-contract-wait",
    ].includes(outcome),
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
    write_started: false,
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
        previousPlay: previousPlaySubmission,
        versionCode: androidVersionCode,
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
    await recordFailure(receipt, error, save);
    throw new Error(
      "Store target stopped; inspect its bounded attempt record",
      {
        cause: error,
      },
    );
  }
}
export async function recordFailure(receipt, error, save, hold = storeLine) {
  const reason = /^[a-z0-9-]+$/.test(error.message)
    ? error.message
    : "store-evidence-unavailable";
  await save({ outcome: "stopped", reason });
  if (
    reason === "app-line-stopped" &&
    receipt.write_started === false &&
    (!receipt.boundary ||
      (receipt.boundary === "store-status.yml" &&
        receipt.boundary_outcome === "success") ||
      (receipt.target === "google-play" &&
        receipt.boundary === "android.yml" &&
        receipt.boundary_outcome === "success"))
  )
    return;
  if (
    reason === "exact-main-ci-required" &&
    receipt.write_started === false &&
    (!receipt.boundary ||
      (receipt.boundary === "store-status.yml" &&
        receipt.boundary_outcome === "success"))
  )
    return;
  if (
    receipt.write_started === false &&
    storeInfrastructureReasons.includes(reason) &&
    (receipt.boundary === "store-status.yml" ||
      !["dispatch-unknown", "waiting"].includes(receipt.boundary_outcome)) &&
    !reason.includes("outcome-unknown") &&
    !reason.includes("identity-unknown")
  )
    return;
  const stopReason =
    reason === "store-rejected"
      ? reason
      : ["dispatch-unknown", "waiting"].includes(receipt.boundary_outcome) ||
          [
            "store-outcome-unknown",
            "store-dispatch-identity-unknown",
            "store-evidence-unavailable",
            "exact-main-ci-required",
          ].includes(reason)
        ? "app-outcome-unknown"
        : "app-publication-failed";
  try {
    await hold(platforms[receipt.target], "stop", stopReason);
  } catch {
    await save({ hold_write_failed: true });
  }
}
export async function prepareBuild(platform) {
  context(platform === "android" ? "android.yml" : "ios-release.yml");
  await assertLinesOpen(platform);
  const source = process.env.SOURCE_SHA,
    version = process.env.STORE_VERSION;
  await qualifyCommit(source, platform);
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
  operation().catch((error) => {
    if (process.argv[2] === "build") {
      // Only fixed policy reasons; never command stderr or response bodies.
      const reason = /^[a-z0-9-]+$/.test(error.message)
        ? error.message
        : "release-evidence-unavailable";
      console.error(`Store CD refused: ${reason}`);
    } else {
      console.error("Store CD refused; inspect the bounded outcome.");
    }
    process.exitCode = 1;
  });
}

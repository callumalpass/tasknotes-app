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
  recheckRefusalReason,
} from "./mobile-release-policy.mjs";
import { readAppleLive, playReviewBlock } from "./store-status.mjs";
import { createStatusClient } from "./app-store-status.mjs";
import { androidVersionCode } from "./publish-google-play.mjs";
import { uploadRefusalReason } from "./testflight-upload-refusal.mjs";

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
  const open = versions.filter(
    (version) =>
      ![
        "READY_FOR_SALE",
        "READY_FOR_DISTRIBUTION",
        "REPLACED_WITH_NEW_VERSION",
        "REMOVED_FROM_SALE",
        "DEVELOPER_REMOVED_FROM_SALE",
      ].includes(version.state),
  );
  // A single never-submitted draft (left by a failed submission) is not in
  // review: the submitter reconciles or adopts it instead of waiting on it.
  if (
    open.length > 1 ||
    (open.length === 1 && open[0].state !== "PREPARE_FOR_SUBMISSION")
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
      if (run.conclusion !== "success")
        throw Object.assign(new Error("store-build-or-publication-failed"), {
          runId,
        });
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
  let sourceRunId;
  try {
    sourceRunId = await services.dispatch(
      buildWorkflow,
      { source_sha: source, version },
      save,
    );
  } catch (error) {
    // A failed iOS build run may retain a fixed TestFlight upload refusal
    // class. It explains the stop but does not change it: the upload may
    // already have reached Apple, so write evidence and the reason stay.
    const reason =
      platform === "ios" && error.runId && services.uploadRefusal
        ? await services.uploadRefusal(error.runId)
        : null;
    if (reason) await save({ boundary_reason: reason });
    throw error;
  }
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
  let publishRunId;
  try {
    publishRunId = await services.dispatch(
      workflow,
      { source_run_id: String(sourceRunId) },
      save,
    );
  } catch (error) {
    // Only a completed failed publisher whose bound receipt says it refused
    // before any store write can name its reason; anything else stays a stop.
    // The iOS TestFlight upload already counts as a write, so an App Store
    // refusal keeps write_started and only records why the publisher refused.
    const reason = error.runId
      ? await services.refusal(error.runId, sourceRunId)
      : null;
    if (!reason) throw error;
    await save({
      ...(platform === "android" ? { write_started: false } : {}),
      boundary_outcome: "refused-before-write",
    });
    throw new Error(reason, { cause: error });
  }
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
  return readAppleStatus(save, () =>
    readAppleLive(
      createStatusClient({
        keyId: process.env.APP_STORE_CONNECT_KEY_ID,
        issuerId: process.env.APP_STORE_CONNECT_ISSUER_ID,
        privateKey: Buffer.from(
          process.env.APP_STORE_CONNECT_PRIVATE_KEY_BASE64 ?? "",
          "base64",
        ).toString("utf8"),
      }),
    ),
  );
}
// The in-process App Store status read is read-only and runs before any store
// write. Its own retries are exhausted by the time it throws, so transport
// failures (timeout, network, HTTP 429/5xx) map onto the existing
// store-status infrastructure reasons and retry quietly. Auth, config and
// contract failures keep a step-specific slug and still stop the line.
export const appleStatusBoundary = "app-store-status-read";
const appleStatusTransport = new Map([
  ["app-store-read-timeout", "store-status-timeout"],
  ["app-store-read-network", "store-status-transport-failed"],
]);
const errorClasses = new Map([
  ["TypeError", "typeerror"],
  ["RangeError", "rangeerror"],
  ["SyntaxError", "syntaxerror"],
  ["Error", "error"],
]);
// HTTP 429 and 5xx persist only after the client's GET retries, so they are
// provider unavailability; any other status (401, 403, 404, ...) stops.
function appleStatusHttp(code) {
  return code === "429" || code.startsWith("5")
    ? "store-status-transport-unavailable"
    : `app-store-status-read-http-${code}`;
}
export function appleStatusReason(error) {
  const tagged =
    boundedSlug(error?.refusal) ?? boundedSlug(error?.cause?.refusal);
  if (tagged) {
    const http = /^app-store-read-http-(\d{3})$/.exec(tagged);
    if (http) return appleStatusHttp(http[1]);
    return (
      appleStatusTransport.get(tagged) ??
      `app-store-status-${tagged.replace(/^app-store-/, "")}`
    );
  }
  // The client's HTTP failure names only the status code we keep; the rest
  // of its message (path, Apple error codes) never leaves the process.
  const http = /^App Store Connect GET \S+: HTTP (\d{3}) /.exec(
    typeof error?.message === "string" ? error.message : "",
  );
  if (http) return appleStatusHttp(http[1]);
  return `app-store-status-read-failed-${errorClasses.get(error?.name) ?? "other"}`;
}
export async function readAppleStatus(save, read) {
  await save({ boundary: appleStatusBoundary, boundary_outcome: "reading" });
  let result;
  try {
    result = await read();
  } catch (error) {
    const reason = appleStatusReason(error);
    await save({ boundary_outcome: "failed" });
    throw Object.assign(new Error(reason), { refusal: reason });
  }
  await save({ boundary_outcome: "success" });
  return result;
}
const slugPattern = /^[a-z0-9-]+$/;
function boundedSlug(value) {
  return typeof value === "string" && slugPattern.test(value) ? value : null;
}
// A bounded reason comes from a slug attached where the error was thrown, a
// fixed policy message, or a slug on its direct cause, in that order. Anything
// else is the fallback: messages that are not slugs never reach the receipt.
export function failureReason(error, fallback = "store-evidence-unavailable") {
  return (
    boundedSlug(error?.refusal) ??
    boundedSlug(error?.message) ??
    boundedSlug(error?.cause?.refusal) ??
    fallback
  );
}
// Boundaries after which a pre-write policy stop is already known to precede
// any store write.
function settledStatusRead(receipt) {
  return (
    ["store-status.yml", appleStatusBoundary].includes(receipt.boundary) &&
    receipt.boundary_outcome === "success"
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
        refusal: async (runId, sourceRunId) => {
          try {
            return recheckRefusalReason(
              await artifactJson(
                runId,
                "store-target-result",
                "store-target-result.json",
              ),
              sourceRunId,
            );
          } catch {
            return null;
          }
        },
        uploadRefusal: async (runId) => {
          try {
            return uploadRefusalReason(
              await artifactJson(
                runId,
                "testflight-upload-result",
                "testflight-upload-result.json",
              ),
              runId,
            );
          } catch {
            return null;
          }
        },
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
  const reason = failureReason(error);
  await save({ outcome: "stopped", reason });
  if (
    reason === "app-line-stopped" &&
    receipt.write_started === false &&
    (!receipt.boundary ||
      settledStatusRead(receipt) ||
      (receipt.target === "google-play" &&
        receipt.boundary === "android.yml" &&
        receipt.boundary_outcome === "success"))
  )
    return;
  if (
    reason === "exact-main-ci-required" &&
    receipt.write_started === false &&
    (!receipt.boundary || settledStatusRead(receipt))
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
      const reason = failureReason(error, "release-evidence-unavailable");
      console.error(`Store CD refused: ${reason}`);
    } else {
      console.error("Store CD refused; inspect the bounded outcome.");
    }
    process.exitCode = 1;
  });
}

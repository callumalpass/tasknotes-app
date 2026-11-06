import { writeFile } from "node:fs/promises";
import { readPlayStatus, playReviewBlock } from "./store-status.mjs";
import { readPlayVitals } from "./play-vitals.mjs";
import { setProductionRollout } from "./publish-google-play.mjs";
import {
  REPO,
  gh,
  artifactJson,
  requirePolicy,
  storeLine,
} from "./mobile-release-policy.mjs";

const HOUR = 3_600_000;
export async function checkMobileBoundaries(fetchImpl = fetch) {
  for (const [url, valid] of [
    [
      "https://connect.mdbase.dev/health",
      (v) => v.ok === true && v.service === "mdbase-connect",
    ],
    ["https://connect.mdbase.dev/ready", (v) => v.ok === true],
    ["https://sync.mdbase.dev/ready", (v) => v.status === "ready"],
  ]) {
    const response = await fetchImpl(url, {
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    requirePolicy(
      response.ok && valid(await response.json()),
      "mobile-boundary-health-failed",
    );
  }
}
export async function monitorOwnedRollout({
  status,
  ownership,
  previous,
  now = Date.now(),
  healthy,
  vitals,
  mutate,
  stop,
  enabled = false,
  held = true,
}) {
  requirePolicy(
    ownership?.track === "production" &&
      ownership.alreadyPublished === false &&
      Number.isSafeInteger(ownership.versionCode) &&
      ownership.sourceRunId &&
      /^[a-f0-9]{40}$/.test(ownership.source ?? ""),
    "owned-rollout-evidence-required",
  );
  const matches = status.live.filter((r) =>
    r.versionCodes?.includes(String(ownership.versionCode)),
  );
  requirePolicy(
    matches.length === 1 && matches[0].versionCodes.length === 1,
    "owned-rollout-evidence-required",
  );
  const release = matches[0];
  requirePolicy(
    ["inProgress", "completed", "halted"].includes(release.status),
    "unknown-rollout-status",
  );
  if (release.status === "halted") {
    await stop();
    return { outcome: "already-halted", versionCode: ownership.versionCode };
  }
  const fraction = release.status === "completed" ? 1 : release.userFraction;
  requirePolicy(
    [0.1, 0.5, 1].includes(fraction),
    "unexpected-rollout-fraction",
  );
  requirePolicy(
    !status.live.some((r) => r !== release && r.status !== "completed"),
    "ambiguous-production-rollout",
  );
  const promoted = Date.parse(ownership.promotedAt);
  requirePolicy(
    Number.isFinite(promoted) && promoted <= now,
    "rollout-time-required",
  );
  const continuous =
    previous?.schema === "tasknotes/mobile-post-release/2" &&
    previous?.sourceRunId === ownership.sourceRunId &&
    previous?.source === ownership.source &&
    previous?.versionCode === ownership.versionCode &&
    previous?.fraction === fraction &&
    now - Date.parse(previous.observedAt) >= 0 &&
    now - Date.parse(previous.observedAt) <= HOUR &&
    Number.isFinite(Date.parse(previous.stageSince)) &&
    Date.parse(previous.stageSince) <= now;
  const stageSince = continuous ? Date.parse(previous.stageSince) : now;
  const report = {
    schema: "tasknotes/mobile-post-release/2",
    source: ownership.source,
    sourceRunId: ownership.sourceRunId,
    versionCode: ownership.versionCode,
    fraction,
    stageSince: new Date(stageSince).toISOString(),
    observedAt: new Date(now).toISOString(),
  };
  async function fail(reason) {
    try {
      // Play cannot turn a fully completed rollout back into a staged halt.
      // Stop future publication; do not invent an automatic downgrade.
      if (fraction !== 1) await mutate({ status: "halted" });
    } finally {
      await stop();
    }
    return {
      ...report,
      outcome:
        fraction === 1
          ? "completed-release-line-stopped"
          : "halted-after-failed-check",
      reason,
    };
  }
  try {
    await healthy();
  } catch {
    return fail("mobile-boundary-health-failed");
  }
  const reviewBlock = playReviewBlock(status);
  if (reviewBlock === "store-rejected") return fail("store-rejected");
  if (reviewBlock)
    return {
      ...report,
      stageSince: new Date(now).toISOString(),
      outcome: "waiting-review-observation",
      reason: reviewBlock,
    };
  const health = await vitals(stageSince);
  if (health.verdict === "failed") return fail("android-vitals-failed");
  if (fraction === 1)
    return { ...report, outcome: "completed-release-monitored", health };
  if (health.verdict !== "passed") {
    if (now - stageSince >= 72 * HOUR)
      return fail("android-vitals-unavailable-or-insufficient");
    return { ...report, outcome: "held-at-current-fraction", health };
  }
  if (!enabled || held)
    return { ...report, outcome: "widening-disabled-or-line-held", health };
  if (now - stageSince < 24 * HOUR)
    return { ...report, outcome: "stage-soaking", health };
  if (fraction === 0.1) {
    await mutate({
      status: "inProgress",
      userFraction: 0.5,
      expectedFraction: 0.1,
    });
    return {
      ...report,
      fraction: 0.5,
      stageSince: new Date(now).toISOString(),
      outcome: "widened-to-50-percent",
      health,
    };
  }
  await mutate({ status: "completed", expectedFraction: 0.5 });
  return {
    ...report,
    fraction: 1,
    stageSince: new Date(now).toISOString(),
    outcome: "rollout-completed",
    health,
  };
}
async function main() {
  requirePolicy(
    process.env.GITHUB_REPOSITORY === REPO &&
      process.env.GITHUB_REF === "refs/heads/main" &&
      process.env.GITHUB_RUN_ATTEMPT === "1",
    "protected-monitor-context-required",
  );
  const credentialBase64 = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64;
  const status = await readPlayStatus(credentialBase64);
  const runs = gh(
    `repos/${REPO}/actions/workflows/google-play-production.yml/runs?branch=main&per_page=100`,
  ).workflow_runs;
  const run = runs.find(
    (r) =>
      r.event === "workflow_dispatch" &&
      r.path === ".github/workflows/google-play-production.yml",
  );
  if (!run && !status.live.some((r) => r.status === "inProgress")) {
    await writeFile(
      "mobile-post-release.json",
      JSON.stringify({ outcome: "no-owned-rollout" }) + "\n",
    );
    return;
  }
  requirePolicy(
    run?.status === "completed" &&
      run.conclusion === "success" &&
      run.run_attempt === 1,
    "owned-rollout-evidence-required",
  );
  const ownership = await artifactJson(
    run.id,
    "mobile-production-result",
    "mobile-production-result.json",
  );
  const owned = status.live.find((r) =>
    r.versionCodes?.includes(String(ownership.versionCode)),
  );
  if (
    owned?.status === "completed" &&
    Date.now() - Date.parse(ownership.promotedAt) > 7 * 24 * HOUR
  ) {
    await writeFile(
      "mobile-post-release.json",
      JSON.stringify({ outcome: "post-release-window-complete" }) + "\n",
    );
    return;
  }
  const monitors = gh(
    `repos/${REPO}/actions/workflows/mobile-post-release.yml/runs?branch=main&per_page=100`,
  ).workflow_runs;
  const last = monitors.find(
    (r) =>
      r.id !== Number(process.env.GITHUB_RUN_ID) &&
      r.status === "completed" &&
      r.run_attempt === 1 &&
      r.path === ".github/workflows/mobile-post-release.yml",
  );
  let previous;
  if (last?.conclusion === "success")
    previous = await artifactJson(
      last.id,
      "mobile-post-release",
      "mobile-post-release.json",
    );
  const line = await storeLine("android");
  const report = await monitorOwnedRollout({
    status,
    ownership,
    previous,
    healthy: () => checkMobileBoundaries(),
    vitals: (since) =>
      readPlayVitals(credentialBase64, {
        versionCode: ownership.versionCode,
        since,
      }),
    mutate: (change) =>
      setProductionRollout({
        credentialBase64,
        expectedVersionCode: ownership.versionCode,
        ...change,
      }),
    stop: () => storeLine("android", "stop", "store-health-failed"),
    enabled: process.env.TASKNOTES_PLAY_AUTOMATION_ENABLED === "true",
    held: line.stopped,
  });
  await writeFile(
    "mobile-post-release.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
if (process.argv[1]?.endsWith("/mobile-post-release.mjs"))
  main().catch(async () => {
    let holdWriteFailed = false;
    try {
      await storeLine("android", "stop", "app-outcome-unknown");
    } catch {
      holdWriteFailed = true;
    }
    await writeFile(
      "mobile-post-release.json",
      JSON.stringify({ outcome: "stopped-unverified", holdWriteFailed }) + "\n",
    );
    console.error(
      "Mobile post-release verification refused; reconcile the bounded report.",
    );
    process.exitCode = 1;
  });

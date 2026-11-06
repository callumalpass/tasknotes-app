import { writeFile } from "node:fs/promises";
import { readPlayStatus } from "./store-status.mjs";
import { setProductionRollout } from "./publish-google-play.mjs";
import {
  REPO,
  gh,
  artifactJson,
  requirePolicy,
  storeLine,
} from "./mobile-release-policy.mjs";

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
export async function haltOwnedRollout({
  status,
  ownership,
  healthy,
  halt,
  stop,
}) {
  const staged = status.live.filter((r) => r.status === "inProgress");
  if (!staged.length) return "no-staged-rollout";
  requirePolicy(
    staged.length === 1 && staged[0].versionCodes?.length === 1,
    "ambiguous-production-rollout",
  );
  const versionCode = staged[0].versionCodes[0];
  requirePolicy(
    ownership?.versionCode === Number(versionCode) &&
      ownership.track === "production" &&
      ownership.sourceRunId &&
      /^[a-f0-9]{40}$/.test(ownership.source ?? ""),
    "owned-rollout-evidence-required",
  );
  try {
    await healthy();
    return "staged-boundaries-healthy-not-completed";
  } catch {
    try {
      await halt(versionCode);
      return "halted-after-failed-check";
    } finally {
      await stop();
    }
  }
}
async function main() {
  requirePolicy(
    process.env.GITHUB_REPOSITORY === REPO &&
      process.env.GITHUB_REF === "refs/heads/main" &&
      process.env.GITHUB_RUN_ATTEMPT === "1",
    "protected-monitor-context-required",
  );
  const status = await readPlayStatus(
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64,
  );
  if (!status.live.some((r) => r.status === "inProgress")) {
    await writeFile(
      "mobile-post-release.json",
      JSON.stringify({ outcome: "no-staged-rollout" }) + "\n",
    );
    return;
  }
  const runs = gh(
    `repos/${REPO}/actions/workflows/google-play-production.yml/runs?branch=main&per_page=100`,
  ).workflow_runs;
  const run = runs.find(
    (r) =>
      r.status === "completed" &&
      r.conclusion === "success" &&
      r.run_attempt === 1,
  );
  requirePolicy(run, "owned-rollout-evidence-required");
  const ownership = await artifactJson(
    run.id,
    "mobile-production-result",
    "mobile-production-result.json",
  );
  const outcome = await haltOwnedRollout({
    status,
    ownership,
    healthy: () => checkMobileBoundaries(),
    halt: (versionCode) =>
      setProductionRollout({
        credentialBase64: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64,
        expectedVersionCode: versionCode,
        status: "halted",
      }),
    stop: () => storeLine("android", "stop", "store-health-failed"),
  });
  await writeFile(
    "mobile-post-release.json",
    JSON.stringify({
      schema: "tasknotes/mobile-post-release/1",
      outcome,
      versionCode: ownership.versionCode,
    }) + "\n",
  );
}
if (process.argv[1]?.endsWith("/mobile-post-release.mjs"))
  main().catch(async () => {
    // Unknown rollout health/ownership must stop only this store. Never
    // manipulate a track without the exact owned-version receipt.
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

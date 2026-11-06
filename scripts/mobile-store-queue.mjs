import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAppleLive } from "./store-status.mjs";
import { createStatusClient } from "./app-store-status.mjs";
import {
  REPO,
  WORKFLOWS,
  gh,
  qualifySource,
  storeLine,
  assertCooldown,
  artifactJson,
  requirePolicy,
} from "./mobile-release-policy.mjs";

const reasonOf = (error) =>
  /^[a-z0-9-]+$/.test(error.message)
    ? error.message
    : "release-evidence-unavailable";
export function newestSourceRuns(commits, runs, platform) {
  const latest = new Map();
  for (const run of [...runs].sort(
    (a, b) => b.id - a.id || b.run_attempt - a.run_attempt,
  )) {
    if (
      platform === "android"
        ? /^android-v/.test(run.head_branch)
        : run.head_branch === "main" || /^ios-v/.test(run.head_branch)
    ) {
      if (!latest.has(run.head_sha)) latest.set(run.head_sha, run);
    }
  }
  return commits.map((c) => latest.get(c.sha)).filter(Boolean);
}
export function appleQueueBlock(versions) {
  if (
    versions.some((v) =>
      ["REJECTED", "METADATA_REJECTED", "DEVELOPER_REJECTED"].includes(v.state),
    )
  )
    return "store-rejected";
  if (
    versions.some((v) =>
      [
        "WAITING_FOR_REVIEW",
        "IN_REVIEW",
        "PENDING_APPLE_RELEASE",
        "PENDING_DEVELOPER_RELEASE",
        "PROCESSING_FOR_APP_STORE",
        "WAITING_FOR_EXPORT_COMPLIANCE",
      ].includes(v.state),
    )
  )
    return "earlier-store-version-in-flight";
  return null;
}
export async function makePlan(platform) {
  requirePolicy(WORKFLOWS[platform], "invalid-platform");
  const plan = {
    schema: "tasknotes/mobile-store-plan/1",
    platform,
    observedAt: new Date().toISOString(),
    candidate: null,
    blockers: [],
    attempts: [],
    dispatchedRunId: null,
  };
  const enabled =
    platform === "android"
      ? process.env.TASKNOTES_PLAY_AUTOMATION_ENABLED
      : process.env.TASKNOTES_APP_STORE_AUTOMATION_ENABLED;
  if (enabled !== "true")
    plan.blockers.push("owner-go-required-automation-disabled");
  const line = await storeLine(platform);
  if (line.stopped) plan.blockers.push("store-line-stopped");
  if (platform === "android") {
    // Consume the concurrency-protected status snapshot. A new edit here
    // could invalidate a publisher's edit under the same service account.
    const observations = gh(
      `repos/${REPO}/actions/workflows/store-status.yml/runs?branch=main&per_page=20`,
    ).workflow_runs;
    const observed = observations.find(
      (r) =>
        r.status === "completed" &&
        r.conclusion === "success" &&
        r.run_attempt === 1,
    );
    requirePolicy(
      observed && Date.now() - Date.parse(observed.created_at) < 7_200_000,
      "fresh-play-status-snapshot-required",
    );
    plan.store = await artifactJson(
      observed.id,
      "store-status-android",
      "store-status-android.json",
    );
    requirePolicy(
      plan.store.schema === "tasknotes/store-status/1" &&
        plan.store.platform === "android",
      "play-status-binding-required",
    );
    plan.blockers.push(
      "play-console-publishing-overview-review-observer-required",
    );
  } else {
    plan.store = await readAppleLive(
      createStatusClient({
        keyId: process.env.APP_STORE_CONNECT_KEY_ID,
        issuerId: process.env.APP_STORE_CONNECT_ISSUER_ID,
        privateKey: Buffer.from(
          process.env.APP_STORE_CONNECT_PRIVATE_KEY_BASE64 ?? "",
          "base64",
        ).toString("utf8"),
      }),
    );
    const block = appleQueueBlock(plan.store.versions);
    if (block) plan.blockers.push(block);
    if (block === "store-rejected")
      await storeLine(platform, "stop", "store-rejected");
  }
  try {
    assertCooldown(
      gh(
        `repos/${REPO}/actions/workflows/${WORKFLOWS[platform]}/runs?per_page=100`,
      ).workflow_runs,
      process.env.GITHUB_RUN_ID,
    );
  } catch (error) {
    plan.blockers.push(reasonOf(error));
  }
  const commits = gh(`repos/${REPO}/commits?sha=main&per_page=100`);
  const workflow = platform === "android" ? "android.yml" : "ios-release.yml";
  const runs = gh(
    `repos/${REPO}/actions/workflows/${workflow}/runs?per_page=100`,
  ).workflow_runs;
  for (const run of newestSourceRuns(commits, runs, platform)) {
    try {
      const source = await qualifySource(platform, run.id);
      const alreadyLive =
        platform === "ios"
          ? plan.store.live.some((v) => v.version === source.version)
          : plan.store.live.some(
              (r) => r.name === `TaskNotes ${source.version}`,
            );
      if (alreadyLive) continue;
      if (platform === "android") {
        const base = Number(process.env.TASKNOTES_ANDROID_VERSION_CODE_BASE);
        requirePolicy(
          Number.isSafeInteger(base) && base >= 0,
          "android-version-code-base-required",
        );
        source.versionCode = base + source.build;
        requirePolicy(
          plan.store.tracks
            .find((t) => t.track === "alpha")
            ?.releases.some(
              (r) =>
                r.status === "completed" &&
                r.versionCodes?.includes(String(source.versionCode)),
            ),
          "completed-closed-testing-required",
        );
      }
      plan.candidate = source;
      break;
    } catch (error) {
      plan.attempts.push({
        source: run.head_sha,
        sourceRunId: run.id,
        reason: reasonOf(error),
      });
    }
  }
  if (!plan.candidate) plan.blockers.push("no-qualified-new-main-build");
  return plan;
}
async function main() {
  const platform = process.argv[2];
  let plan;
  try {
    plan = await makePlan(platform);
    // Retain the decision before the dispatch boundary; the workflow uploads it
    // in a separate step before invoking --dispatch.
    await writeFile(
      "mobile-store-plan.json",
      JSON.stringify(plan, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        platform,
        candidate: plan.candidate,
        blockers: plan.blockers,
      }),
    );
  } catch (error) {
    await writeFile(
      "mobile-store-plan.json",
      JSON.stringify(
        {
          schema: "tasknotes/mobile-store-plan/1",
          platform,
          blockers: [reasonOf(error)],
        },
        null,
        2,
      ) + "\n",
    );
    throw error;
  }
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
)
  main().catch((error) => {
    console.error(reasonOf(error));
    process.exitCode = 1;
  });

import { readFile, writeFile } from "node:fs/promises";
import {
  REPO,
  WORKFLOWS,
  gh,
  requirePolicy,
  storeLine,
} from "./mobile-release-policy.mjs";
import { makePlan } from "./mobile-store-queue.mjs";

const platform = process.argv[2];
const receipt = {
  schema: "tasknotes/mobile-store-attempt/1",
  platform,
  outcome: "not-dispatched",
  runId: null,
};
const save = () =>
  writeFile(
    "mobile-store-attempt.json",
    JSON.stringify(receipt, null, 2) + "\n",
  );
try {
  requirePolicy(
    process.env.GITHUB_REPOSITORY === REPO &&
      process.env.GITHUB_REF === "refs/heads/main" &&
      process.env.GITHUB_RUN_ATTEMPT === "1" &&
      process.env.GITHUB_WORKFLOW_REF ===
        `${REPO}/.github/workflows/mobile-store-queue.yml@refs/heads/main` &&
      ["schedule", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME),
    "queue-context-required",
  );
  const before = JSON.parse(await readFile("mobile-store-plan.json", "utf8"));
  const fresh = await makePlan(platform);
  if (fresh.blockers.length || !fresh.candidate) {
    receipt.outcome = "quiet-wait";
    await save();
  } else {
    requirePolicy(
      before.candidate?.sourceRunId === fresh.candidate.sourceRunId &&
        before.candidate?.source === fresh.candidate.source,
      "candidate-changed-replan-required",
    );
    receipt.source = fresh.candidate;
    receipt.outcome = "dispatch-unknown";
    await save();
    const inputs =
      platform === "ios"
        ? {
            source_run_id: String(fresh.candidate.sourceRunId),
            submit: "true",
            release: "false",
          }
        : { release_tag: `android-v${fresh.candidate.version}` };
    const result = gh(
      `repos/${REPO}/actions/workflows/${WORKFLOWS[platform]}/dispatches`,
      {
        body: { ref: "main", inputs, return_run_details: true },
      },
    );
    requirePolicy(
      Number.isSafeInteger(result.workflow_run_id),
      "store-dispatch-identity-unknown",
    );
    receipt.runId = result.workflow_run_id;
    receipt.outcome = "waiting";
    await save();
    for (let attempt = 0; attempt < 180; attempt++) {
      const run = gh(`repos/${REPO}/actions/runs/${receipt.runId}`);
      requirePolicy(
        run.path === `.github/workflows/${WORKFLOWS[platform]}` &&
          run.head_branch === "main" &&
          run.event === "workflow_dispatch" &&
          run.run_attempt === 1,
        "store-run-binding-required",
      );
      if (run.status === "completed") {
        requirePolicy(run.conclusion === "success", "store-publication-failed");
        receipt.outcome = "submitted-not-proof-of-live";
        break;
      }
      await new Promise((done) => setTimeout(done, 15000));
    }
    requirePolicy(receipt.outcome !== "waiting", "store-outcome-unknown");
    await save();
  }
} catch {
  if (["dispatch-unknown", "waiting"].includes(receipt.outcome)) {
    // Do not cancel or resubmit an unknown store mutation. Stop this line and
    // reconcile the exact store/run; rejection is agent work, not owner work.
    receipt.outcome = "stopped-unknown";
    try {
      await storeLine(platform, "stop", "app-outcome-unknown");
    } catch {
      receipt.holdWriteFailed = true;
    }
  } else receipt.outcome = "preflight-refused";
  await save();
  console.error(
    "Mobile store queue refused; inspect its bounded attempt report.",
  );
  process.exitCode = 1;
}

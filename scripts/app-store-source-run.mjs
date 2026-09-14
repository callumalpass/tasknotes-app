import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveSourceRun(run, artifacts, repo) {
  if (
    repo !== "callumalpass/tasknotes-app" ||
    run.repository?.full_name !== repo ||
    run.head_repository?.full_name !== repo ||
    run.path !== ".github/workflows/ios-release.yml" ||
    run.conclusion !== "success" ||
    run.status !== "completed" ||
    !["push", "workflow_dispatch"].includes(run.event) ||
    !/^[0-9a-f]{40}$/.test(run.head_sha) ||
    !Number.isSafeInteger(run.run_number) ||
    run.run_number < 1
  ) {
    throw new Error(
      "Source must be a successful trusted iOS release run in this repository",
    );
  }
  const candidates = artifacts.filter(
    (artifact) => !artifact.expired && /^tasknotes-ios-/.test(artifact.name),
  );
  if (candidates.length !== 1)
    throw new Error("Expected exactly one unexpired iOS release artifact");
  const match = /^tasknotes-ios-(\d+\.\d+\.\d+)-(\d+)$/.exec(
    candidates[0].name,
  );
  if (!match || match[2] !== String(run.run_number))
    throw new Error("Artifact does not match source run build number");
  return { version: match[1], build: match[2], sha: run.head_sha };
}

async function main() {
  const runId = process.env.SOURCE_RUN_ID;
  const repo = process.env.GH_REPO;
  if (!/^[1-9]\d*$/.test(runId ?? "")) throw new Error("Invalid source run ID");
  if (repo !== "callumalpass/tasknotes-app")
    throw new Error("Unexpected repository");
  const api = (path, paginate = false) =>
    JSON.parse(
      execFileSync(
        "gh",
        ["api", ...(paginate ? ["--paginate", "--slurp"] : []), path],
        { encoding: "utf8" },
      ),
    );
  const run = api(`repos/${repo}/actions/runs/${runId}`);
  const artifacts = api(
    `repos/${repo}/actions/runs/${runId}/artifacts`,
    true,
  ).flatMap((page) => page.artifacts);
  const source = resolveSourceRun(run, artifacts, repo);
  // Publication policy and version-specific notes come from the approved workflow
  // commit. Never execute scripts from arbitrary artifact contents or source refs.
  execFileSync("git", ["merge-base", "--is-ancestor", source.sha, "HEAD"]);
  await appendFile(
    process.env.GITHUB_ENV,
    `TASKNOTES_IOS_VERSION=${source.version}\nTASKNOTES_IOS_BUILD=${source.build}\n`,
  );
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `## Source build\n\n[iOS release run ${runId}](https://github.com/${repo}/actions/runs/${runId})\n\nCommit: \`${source.sha}\`\n\nVersion **${source.version}**, build **${source.build}**.\n`,
  );
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

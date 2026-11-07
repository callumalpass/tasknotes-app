import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertProductionEnabled } from "./release-gates.mjs";
export function deploymentFor(target) {
  if (!["staging", "production"].includes(target))
    throw Error("Unknown TaskNotes target");
  return {
    target,
    project: "tasknotes-app",
    origin:
      target === "staging"
        ? "https://staging.tasknotes.dev"
        : "https://app.tasknotes.dev",
    connectOrigin:
      target === "staging"
        ? "https://connect-staging.mdbase.dev"
        : "https://connect.mdbase.dev",
    branch: target === "staging" ? "staging" : "main",
  };
}
export function assertDispatch(env = process.env) {
  const d = deploymentFor(env.TARGET),
    sha = env.SOURCE_SHA;
  if (
    !/^[a-f0-9]{40}$/.test(sha ?? "") ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/main"
  )
    throw Error("TaskNotes dispatch requires main and a full source SHA");
  return { ...d, sha };
}
export function assertCheckout(binding, cwd = process.cwd()) {
  const git = (args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  if (
    git(["rev-parse", "HEAD"]) !== binding.sha ||
    git(["status", "--porcelain", "--untracked-files=all"]) !== ""
  )
    throw Error("TaskNotes publisher requires exact clean source");
  assertAncestor(binding, cwd);
  return {
    sha: binding.sha,
    tree: git(["rev-parse", "HEAD^{tree}"]),
    target: binding.target,
  };
}
export function assertAncestor(binding, cwd = process.cwd()) {
  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", binding.sha, "refs/remotes/origin/main"],
      {
        cwd,
        stdio: "pipe",
      },
    );
  } catch {
    throw Error("TaskNotes source must be an ancestor of origin/main");
  }
}
export async function assertGreenSource(
  source,
  { fetchImpl = fetch, token = process.env.GITHUB_TOKEN } = {},
) {
  if (!/^[a-f0-9]{40}$/.test(source ?? ""))
    throw Error("exact-source-ci-required");
  const response = await fetchImpl(
    `https://api.github.com/repos/callumalpass/tasknotes-app/actions/workflows/ci.yml/runs?head_sha=${source}&branch=main&event=push&per_page=100`,
    {
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
  if (!response.ok) throw Error("exact-source-ci-required");
  const runs =
    (await response.json()).workflow_runs?.filter(
      (run) =>
        run.head_sha === source &&
        run.head_branch === "main" &&
        run.event === "push" &&
        run.path === ".github/workflows/ci.yml",
    ) ?? [];
  runs.sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt);
  if (runs[0]?.status !== "completed" || runs[0]?.conclusion !== "success")
    throw Error("exact-source-ci-required");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const binding = assertDispatch();
    assertProductionEnabled(binding.target);
    assertAncestor(binding);
    await assertGreenSource(binding.sha);
  } catch {
    console.error(
      "TaskNotes dispatch requires an admitted main ancestor with exact passing main CI",
    );
    process.exitCode = 1;
  }
}

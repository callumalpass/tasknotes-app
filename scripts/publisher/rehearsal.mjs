// Source qualification only: no dispatch, tag, deployment or privileged receipt.
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOriginals } from "./originals.mjs";
import { prepareInstall } from "./install-inputs.mjs";
import { deploymentFor } from "./refs.mjs";
const target = process.argv[2];
if (!["staging", "production"].includes(target))
  throw Error("Explicit target required");
if (process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_ACCOUNT_ID)
  throw Error("No deployment credentials permitted");
const policy = JSON.parse(
  await readFile("config/sdk-publication.json", "utf8"),
).sdkPublication;
const sdkTrust = await loadOriginals({
  target,
  repoRoot: process.cwd(),
  hashes: { TASKNOTES_TRUST_ASSET_SHA256: policy.environments[target].sha256 },
});
const publicFiles = [];
const d = deploymentFor(target),
  plan = {
    qualificationOnly: true,
    sha: "0".repeat(40),
    tree: "0".repeat(40),
    target,
    origin: d.origin,
    pagesBranch: d.branch,
    publicFiles,
    sdkTrust,
  };
const base = await mkdtemp(join(tmpdir(), "tasknotes-rehearsal-")),
  root = join(base, "candidate"),
  publisher = join(base, "publisher"),
  output = join(base, "artifact");
try {
  await mkdir(root);
  await mkdir(publisher);
  await mkdir(output);
  // Match Actions: workflow-owned publisher has NO workspace dependencies.
  await cp("scripts", join(publisher, "scripts"), { recursive: true });
  for (const path of [
    "src",
    "tests",
    "public",
    "scripts",
    "tools",
    "vendor",
    "config",
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.node.json",
    "vite.config.ts",
    "index.html",
    "lingui.config.ts",
    "i18n-policy.json",
    "eslint.config.js",
  ])
    await cp(path, join(root, path), { recursive: true });
  await writeFile(
    join(output, "plan.json"),
    JSON.stringify(plan, null, 2) + "\n",
  );
  await prepareInstall(plan, root);
  const env = { ...process.env, TASKNOTES_SOURCE_ROOT: root };
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN; // No reader credentials reach SDK/app execution.
  execFileSync(
    "pnpm",
    ["install", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile"],
    { cwd: root, env, stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    [join(publisher, "scripts/publisher/build.mjs"), output],
    { cwd: root, env, stdio: "inherit" },
  );
  console.log(
    "Authenticated " +
      target +
      " build and complete inventory rehearsal passed; no deployment",
  );
} finally {
  await rm(base, { recursive: true, force: true });
}

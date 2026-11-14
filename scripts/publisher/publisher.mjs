// Dependency-free reviewed source. No candidate SDK modules in the protected job.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { digestNames, loadOriginals, protectedHashes } from "./originals.mjs";
import {
  assertInventory,
  inventoryDirectory,
} from "../lib/native-publish-bytes.mjs";
import { assertCheckout, assertDispatch, deploymentFor } from "./refs.mjs";
import { assertHostingSource } from "./hosting-policy.mjs";
import { assertBuiltTarget, assertInventoryCoverage } from "./checks.mjs";
import { assertProductionEnabled } from "./release-gates.mjs";
export { assertInventoryCoverage } from "./checks.mjs";
import { assertOfflineShell } from "../lib/native-offline-shell.mjs";
import { assertArtifactMetadata, assertArtifactRun } from "./artifact.mjs";
const need = (ok, message) => {
  if (!ok) throw Error(`TaskNotes publisher refusal: ${message}`);
};
// Runtime pins and hosting policy are the candidate's data, so an ancestor of main validates against itself.
export const sourceRoot = (env = process.env) =>
  env.TASKNOTES_SOURCE_ROOT ?? process.cwd();
export async function sourcePlan({
  env = process.env,
  cwd = sourceRoot(env),
  installed = false,
} = {}) {
  const binding = assertDispatch(env);
  assertProductionEnabled(binding.target);
  const source = assertCheckout(binding, cwd);
  const sdkTrust = await loadOriginals({
    target: binding.target,
    repoRoot: cwd,
    hashes: protectedHashes(env),
    installed,
  });
  const target = deploymentFor(binding.target);
  need(
    target.origin === sdkTrust.appOrigin &&
      target.connectOrigin === sdkTrust.release.cpOrigin,
    "target origin/CP mismatch",
  );
  return {
    ...source,
    publicFiles: execFileSync("git", ["ls-files", "-z", "public"], {
      cwd,
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean),
    origin: target.origin,
    pagesBranch: target.branch,
    pagesProject: target.project,
    sdkTrust,
  };
}
// Canonical artifact inventory bytes: UTF-8, two-space JSON, NO trailing LF.
// Shared by the build tasknotes and protected CLI; plans keep their existing LF.
export function serializeInventory(inventory) {
  return JSON.stringify(inventory, null, 2);
}
export async function publicationInventory(directory, plan) {
  const inventory = await inventoryDirectory(directory, {
    maxFileBytes: 25 * 1024 * 1024,
  });
  const html = await readFile(join(directory, "index.html"), "utf8");
  const entries = [...html.matchAll(/<script\b[^>]*>/gi)].flatMap(([tag]) => [
    ...tag.matchAll(
      /\ssrc=["'](\/assets\/index-tasknotes-([a-f0-9]{12})\.js)["']/g,
    ),
  ]);
  need(
    entries.length === 1 &&
      entries[0][2] === plan.sha.slice(0, 12) &&
      inventory.some((a) => "/" + a.path === entries[0][1]),
    "source-bound TaskNotes entry required",
  );
  assertBuiltTarget({
    target: plan.target,
    manifest: JSON.parse(
      await readFile(join(directory, ".well-known/mdbase-app.json"), "utf8"),
    ),
  });
  assertInventoryCoverage(inventory, plan.sdkTrust);
  await assertHostingSource(directory, inventory);
  await assertOfflineShell({
    directory,
    assets: inventory,
    sdkTrust: { sdk: { offlineShell: plan.sdkTrust.offlineShell } },
  });
  return inventory;
}
export function deploymentPrefix(output) {
  const urls = [
    ...new Set(
      [
        ...output.matchAll(
          /https:\/\/([a-f0-9]{8,32})\.tasknotes-app\.pages\.dev\b/g,
        ),
      ].map((m) => m[1]),
    ),
  ];
  need(urls.length === 1, "no unambiguous deployment URL");
  return urls[0];
}
export async function assertExistingProject({
  accountId,
  apiToken,
  fetchImpl = fetch,
}) {
  need(
    /^[a-f0-9]{32}$/.test(accountId ?? "") && apiToken,
    "existing account credentials required",
  );
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/tasknotes-app`,
    {
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${apiToken}` },
    },
  );
  need(response.ok, "existing Pages project lookup failed");
  const body = await response.json();
  need(
    body.success &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
        body.result?.id ?? "",
      ) &&
      body.result.id === "8f377e88-f1d0-4a5a-8928-2daa3e7c527a" &&
      body.result.name === "tasknotes-app" &&
      body.result.production_branch === "main",
    "existing approved project identity/channel mismatch",
  );
  return {
    id: body.result.id,
    name: body.result.name,
    productionBranch: body.result.production_branch,
  };
}
// The deployments list can lag a just-finished upload or rate-limit concurrent publishes, so
// capture re-reads it (GET only, never re-uploading) within a fixed bound and stays fail-closed.
export const CAPTURE_DELAYS = [5000, 10000, 15000, 30000, 45000];
export const CAPTURE_READ_TIMEOUT = 10000;
const captureBudget = CAPTURE_DELAYS.reduce((sum, delay) => sum + delay, 0);
const deploymentUuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const retryAfterMs = (value) => {
  if (/^\d+$/.test(value ?? "")) return Number(value) * 1000;
  const at = Date.parse(value ?? "");
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
};
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
export async function captureDeployment({
  output,
  target,
  sha,
  accountId,
  apiToken,
  fetchImpl = fetch,
  sleep = wait,
}) {
  need(
    /^[a-f0-9]{32}$/.test(accountId ?? "") && apiToken,
    "existing account credentials required",
  );
  const prefix = deploymentPrefix(output),
    url = `https://${prefix}.tasknotes-app.pages.dev`;
  const branch = deploymentFor(target).branch;
  const lookupFailed = "deployment UUID lookup failed",
    mismatch = "actual deployment UUID/source/channel mismatch";
  let slept = 0;
  for (const delay of [...CAPTURE_DELAYS, null]) {
    let status,
      retryAfter = null,
      body;
    try {
      const response = await fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/tasknotes-app/deployments?per_page=20`,
        {
          redirect: "error",
          signal: AbortSignal.timeout(CAPTURE_READ_TIMEOUT),
          headers: { Authorization: `Bearer ${apiToken}` },
        },
      );
      status = response.status;
      retryAfter = response.headers?.get("retry-after") ?? null;
      if (response.ok) body = await response.json();
    } catch {
      status = 0; // No response, a timeout or an unreadable body is transient.
    }
    const transient = status === 0 || status === 429 || status >= 500;
    need(transient || (status >= 200 && status < 300), lookupFailed);
    let refusal = lookupFailed;
    if (!transient) {
      const matches =
        body?.success && Array.isArray(body.result)
          ? body.result.filter(
              (d) =>
                d.url === url &&
                d.deployment_trigger?.metadata?.commit_hash === sha &&
                d.deployment_trigger?.metadata?.branch === branch,
            )
          : [];
      // Ambiguity or a malformed id is a real conflict, never lag: refuse at once.
      need(matches.length <= 1, mismatch);
      if (matches.length === 1) {
        need(deploymentUuid.test(matches[0].id ?? ""), mismatch);
        return { id: matches[0].id, url, sourceSha: sha, pagesBranch: branch };
      }
      refusal = mismatch;
    }
    need(delay !== null, refusal);
    const pause = Math.min(
      Math.max(delay, transient ? retryAfterMs(retryAfter) : 0),
      captureBudget - slept,
    );
    slept += pause;
    await sleep(pause);
  }
}
export function createReceipt({
  plan,
  inventory = [],
  deployment,
  verification,
  artifact,
  project,
  previous,
  rollback,
  env = process.env,
}) {
  let artifactBound = false;
  try {
    const expected = {
      id: env.ARTIFACT_ID,
      digest: "sha256:" + (env.ARTIFACT_DIGEST ?? "").replace(/^sha256:/, ""),
      repository: env.GITHUB_REPOSITORY,
      repositoryId: env.GITHUB_REPOSITORY_ID,
      run: env.GITHUB_RUN_ID,
      attempt: env.GITHUB_RUN_ATTEMPT,
      event: env.GITHUB_EVENT_NAME,
      ref: env.GITHUB_REF,
      workflowSha: env.GITHUB_SHA,
      source: plan.sha,
      tree: plan.tree,
      target: plan.target,
    };
    need(
      isDeepStrictEqual(artifact.expected, expected),
      "receipt artifact identity",
    );
    assertArtifactMetadata(artifact.before, expected);
    assertArtifactMetadata(artifact.after, expected);
    assertArtifactRun(artifact.run, expected);
    assertArtifactRun(artifact.runAfter, expected);
    need(
      artifact.downloadedSha256 === expected.digest.slice(7),
      "receipt actual ZIP digest",
    );
    artifactBound = true;
  } catch {
    /* Failed/incomplete evidence is still retained below. */
  }
  const projectBound =
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(project?.id ?? "") &&
    project.id === "8f377e88-f1d0-4a5a-8928-2daa3e7c527a" &&
    project.name === "tasknotes-app" &&
    project.productionBranch === "main";
  const covers = (report) => {
    const all = [...(report?.verified ?? []), ...(report?.controls ?? [])];
    return (
      report?.ok === true &&
      report.failures?.length === 0 &&
      report.unverified?.length === 0 &&
      all.length === inventory.length &&
      inventory.every(
        (a) =>
          all.filter(
            (b) =>
              a.path === b.path && a.sha256 === b.sha256 && a.bytes === b.bytes,
          ).length === 1,
      )
    );
  };
  const complete =
    covers(verification) &&
    verification.origins?.length === 2 &&
    [plan.origin, deployment?.url].every(
      (origin) =>
        verification.origins.filter((r) => r.origin === origin && covers(r))
          .length === 1,
    );
  const uuid =
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
      deployment?.id ?? "",
    ) &&
    deployment.sourceSha === plan.sha &&
    deployment.pagesBranch === plan.pagesBranch;
  return {
    schema: "tasknotes-app/native-publisher-receipt@1",
    status:
      complete && uuid && inventory.length && artifactBound && projectBound
        ? "verified"
        : "failed-or-incomplete",
    source: plan,
    run: {
      repository: env.GITHUB_REPOSITORY,
      id: env.GITHUB_RUN_ID,
      attempt: env.GITHUB_RUN_ATTEMPT,
      event: env.GITHUB_EVENT_NAME,
      ref: env.GITHUB_REF,
    },
    protectedHashes: Object.fromEntries(
      digestNames.map((k) => [k, env[k] ?? null]),
    ),
    previous: previous ?? null,
    rollback: rollback ?? null,
    project: project ?? null,
    artifact: artifact ?? { id: env.ARTIFACT_ID, digest: env.ARTIFACT_DIGEST },
    assets: inventory,
    deployment: deployment ?? null,
    verification: verification ?? {
      ok: false,
      reason: "not attempted/available",
    },
    authentication: plan.sdkTrust?.authentication ?? null,
    admission: "not assessed",
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const json = async (path) => JSON.parse(await readFile(path, "utf8"));
  try {
    if (command === "guard")
      console.log(
        JSON.stringify(
          await sourcePlan({ installed: args.includes("--installed") }),
          null,
          2,
        ),
      );
    else if (command === "inventory")
      process.stdout.write(
        serializeInventory(
          await publicationInventory(args[0], await json(args[1])),
        ),
      );
    else if (command === "assert-inventory")
      await assertInventory(args[0], await json(args[1]));
    else if (command === "project")
      console.log(
        JSON.stringify(
          await assertExistingProject({
            accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
            apiToken: process.env.CLOUDFLARE_API_TOKEN,
          }),
          null,
          2,
        ),
      );
    else if (command === "capture")
      console.log(
        JSON.stringify(
          await captureDeployment({
            output: await readFile(args[0], "utf8"),
            target: process.env.TARGET,
            sha: process.env.SOURCE_SHA,
            accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
            apiToken: process.env.CLOUDFLARE_API_TOKEN,
          }),
          null,
          2,
        ),
      );
    else if (command === "receipt") {
      const optional = async (path) => {
        try {
          return await json(path);
        } catch {
          return null;
        }
      };
      const dir = resolve(args[0]);
      const plan = (await optional(join(dir, "plan.json"))) ?? {
        sha: process.env.SOURCE_SHA,
        tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
          cwd: process.env.TASKNOTES_SOURCE_ROOT ?? process.cwd(),
          encoding: "utf8",
        }).trim(),
        target: process.env.TARGET,
      };
      const receipt = createReceipt({
        plan,
        inventory: (await optional(join(dir, "inventory.json"))) ?? [],
        deployment: await optional(join(dir, "deployment.json")),
        verification: await optional(join(dir, "verification.json")),
        artifact: await optional(join(dir, "artifact-metadata.json")),
        project: await optional(join(dir, "project.json")),
        previous: await optional(join(dir, "previous.json")),
        rollback: await optional(join(dir, "rollback.json")),
      });
      console.log(JSON.stringify(receipt, null, 2));
      if (receipt.status !== "verified") process.exitCode = 1;
    } else throw Error("Unknown native publisher command");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

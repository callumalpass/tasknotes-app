// Protected job entry point. Built artifact is DATA ONLY. No app dependency
// install, build, SDK import, hooks, artifact-provided scripts or policy mutation.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify, isDeepStrictEqual } from "node:util";
import { assertInventory } from "./lib/native-publish-bytes.mjs";
import { verifyTargetIntake } from "./lib/native-publish-intake.mjs";
import {
  assertCheckout,
  createReceipt,
  parsePublishRequest,
  parseWranglerDeployment,
  runGit,
} from "./native-publisher.mjs";
import {
  selectServedChecks,
  verifyServedAssets,
} from "./verify-native-served.mjs";
import { verifyTrustedHostingPolicy } from "./lib/native-publish-hosting.mjs";
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (a, b, label) => {
  if (!isDeepStrictEqual(a, b)) throw new Error(`${label} mismatch.`);
};

export function validateArtifactMetadata({
  metadata,
  run,
  id,
  digest,
  repository,
  runId,
  attempt,
  sourceSha,
  target,
}) {
  if (
    !/^[1-9][0-9]*$/.test(id ?? "") ||
    !/^[a-f0-9]{64}$/.test(digest ?? "") ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")
  )
    throw new Error("Missing immutable artifact identity/digest/repository.");
  same(String(metadata.id), id, "Artifact ID");
  same(metadata.digest, `sha256:${digest}`, "Immutable artifact digest");
  same(metadata.expired, false, "Artifact expiry");
  same(
    metadata.name,
    `tasknotes-native-build-${target}-${sourceSha}-${runId}-${attempt}`,
    "Artifact target/source/run/attempt name",
  );
  same(String(metadata.workflow_run?.id), runId, "Artifact run ID");
  same(metadata.workflow_run?.head_sha, sourceSha, "Artifact source");
  same(run.repository?.full_name, repository, "Artifact repository");
  same(
    metadata.workflow_run?.repository_id,
    run.repository?.id,
    "Artifact repository ID",
  );
  same(
    metadata.workflow_run?.head_repository_id,
    run.repository?.id,
    "Artifact source repository ID",
  );
  same(
    metadata.workflow_run?.head_branch,
    `release/native-${target}`,
    "Artifact native target branch",
  );
  same(String(run.id), runId, "Run ID");
  same(String(run.run_attempt), attempt, "Run attempt");
  same(run.head_sha, sourceSha, "Run source");
  same(run.event, "workflow_dispatch", "Run event");
  same(run.head_branch, `release/native-${target}`, "Run native target branch");
}

export async function assertCurrentReleaseHead({
  target,
  sourceSha,
  git = runGit,
}) {
  // Unlike local origin/*, ls-remote observes the actual current authorized head.
  const output = (
    await git([
      "ls-remote",
      "--exit-code",
      "origin",
      `refs/heads/${target.releaseRef}`,
    ])
  ).trim();
  same(
    output,
    `${sourceSha}\trefs/heads/${target.releaseRef}`,
    "IMMEDIATE current native HEAD",
  );
}

export function validatePreparedReceipt({
  receipt,
  target,
  sourceSha,
  sourceTree,
  sdkTrust,
  environment,
}) {
  same(receipt.status, "prepared", "Prepared-only (no repeated upload)");
  same(
    receipt.source,
    { sha: sourceSha, tree: sourceTree },
    "Artifact source/tree",
  );
  same(
    receipt.target,
    createReceipt({ target }).target,
    "Artifact target/origins/channel",
  );
  same(
    receipt.run,
    {
      repository: environment.GITHUB_REPOSITORY,
      id: environment.GITHUB_RUN_ID,
      attempt: environment.GITHUB_RUN_ATTEMPT,
    },
    "Artifact repository/run/attempt",
  );
  same(
    receipt.sdkTrust,
    sdkTrust,
    "Artifact full original inventory/target SDK binding",
  );
  selectServedChecks(receipt.assets);
  for (const [expected, extension] of [
    [sdkTrust.sdk.native.sha256, ".wasm"],
    [sdkTrust.sdk.native.sqliteSha256, ".wasm"],
    [sdkTrust.sdk.native.sqliteInitializerSha256, ".js"],
  ])
    if (
      !receipt.assets.some(
        (a) => a.path.endsWith(extension) && a.sha256 === expected,
      )
    )
      throw new Error("Required original native/SQLite coverage mismatch.");
}

async function boundedBytes(response, maximum) {
  if (!response.ok || !response.body)
    throw new Error("Artifact transport refused.");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximum) throw new Error("Artifact response size limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function downloadArtifact(environment, request, directory) {
  const repo = environment.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? ""))
    throw new Error("Invalid repository.");
  if (!/^[1-9][0-9]*$/.test(environment.NATIVE_ARTIFACT_ID ?? ""))
    throw new Error("Missing immutable artifact ID.");
  const api = `https://api.github.com/repos/${repo}/actions`;
  const headers = {
    Authorization: `Bearer ${environment.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const get = async (suffix) =>
    JSON.parse(
      (
        await boundedBytes(
          await fetch(api + suffix, {
            headers,
            redirect: "error",
            signal: AbortSignal.timeout(30000),
          }),
          2 * 1024 * 1024,
        )
      ).toString(),
    );
  const metadata = await get(`/artifacts/${environment.NATIVE_ARTIFACT_ID}`);
  const run = await get(
    `/runs/${environment.GITHUB_RUN_ID}/attempts/${environment.GITHUB_RUN_ATTEMPT}`,
  );
  validateArtifactMetadata({
    metadata,
    run,
    id: environment.NATIVE_ARTIFACT_ID,
    digest: environment.NATIVE_ARTIFACT_DIGEST,
    repository: repo,
    runId: environment.GITHUB_RUN_ID,
    attempt: environment.GITHUB_RUN_ATTEMPT,
    sourceSha: request.sourceSha,
    target: request.target.target,
  });
  // Official artifact zip endpoint, NEVER an artifact-supplied download script.
  const redirect = await fetch(
    `${api}/artifacts/${environment.NATIVE_ARTIFACT_ID}/zip`,
    { headers, redirect: "manual", signal: AbortSignal.timeout(30000) },
  );
  const address = new URL(redirect.headers.get("location"));
  if (
    redirect.status !== 302 ||
    address.protocol !== "https:" ||
    address.username ||
    address.password ||
    !address.hostname.endsWith(".blob.core.windows.net")
  )
    throw new Error("Artifact download redirect refused.");
  const bytes = await boundedBytes(
    await fetch(address, {
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(120000),
    }),
    512 * 1024 * 1024,
  );
  same(
    hash(bytes),
    environment.NATIVE_ARTIFACT_DIGEST,
    "Downloaded immutable ZIP digest",
  );
  const archive = join(directory, "artifact.zip");
  await writeFile(archive, bytes, { flag: "wx" });
  const artifact = join(directory, "artifact");
  await exec("python3", [
    "-I",
    "-B",
    join(root, "scripts/native-artifact-extract.py"),
    archive,
    artifact,
  ]);
  return { artifact, metadata, run };
}

export async function upload(environment = process.env) {
  if (environment.GITHUB_EVENT_NAME !== "workflow_dispatch")
    throw new Error("Manual native dispatch required.");
  const request = parsePublishRequest({
    target: environment.NATIVE_TARGET,
    sourceSha: environment.NATIVE_SOURCE_SHA,
    dispatchRef: environment.GITHUB_REF,
  });
  await assertCheckout({ ...request, workflowSha: environment.GITHUB_SHA });
  const { target, sourceSha } = request;
  // Original-byte validation against FOUR protected env inputs. No auth boolean,
  // no candidate-derived fallback; actual missing target intake refuses.
  const sdkTrust = await verifyTargetIntake({
    root,
    target,
    approvedHashes: {
      sdk: environment.NATIVE_SDK_SHA256,
      ui: environment.NATIVE_UI_SHA256,
      protocol: environment.NATIVE_PROTOCOL_SHA256,
      asset: environment.NATIVE_TRUST_ASSET_SHA256,
    },
  });
  const directory = resolve(environment.NATIVE_EVIDENCE_PATH);
  if (!directory.startsWith(resolve(environment.RUNNER_TEMP) + "/"))
    throw new Error("Evidence must be outside checkout in runner temp.");
  await mkdir(directory, { recursive: true });
  const evidence = join(directory, "receipt.json");
  let receipt = {
    status: "intake-validated",
    source: { sha: sourceSha },
    run: {
      repository: environment.GITHUB_REPOSITORY,
      id: environment.GITHUB_RUN_ID,
      attempt: environment.GITHUB_RUN_ATTEMPT,
    },
    sdkTrust,
  };
  const save = async () =>
    writeFile(evidence, JSON.stringify(receipt, null, 2) + "\n");
  await save();
  try {
    const { artifact, metadata, run } = await downloadArtifact(
      environment,
      request,
      directory,
    );
    const prepared = JSON.parse(
      await readFile(join(artifact, "receipt.json"), "utf8"),
    );
    validatePreparedReceipt({
      receipt: prepared,
      target,
      sourceSha,
      sourceTree: (await runGit(["rev-parse", "HEAD^{tree}"])).trim(),
      sdkTrust,
      environment,
    });
    receipt = {
      ...prepared,
      immutableArtifact: {
        id: metadata.id,
        digest: metadata.digest,
        metadata,
        run,
      },
      deployment: null,
    };
    await save();
    const output = join(directory, "wrangler.jsonl");
    await writeFile(output, "", { flag: "wx" });
    const tool = resolve(environment.NATIVE_WRANGLER_PATH);
    if (
      tool !==
      join(
        resolve(environment.RUNNER_TEMP),
        "tasknotes-publish-tooling/node_modules/wrangler/bin/wrangler.js",
      )
    )
      throw new Error("Independent pinned Wrangler tooling path required.");
    same(
      JSON.parse(await readFile(resolve(tool, "../../package.json"), "utf8"))
        .version,
      "4.114.0",
      "Pinned independent Wrangler",
    );
    if (!environment.CLOUDFLARE_API_TOKEN || !environment.CLOUDFLARE_ACCOUNT_ID)
      throw new Error("Missing Cloudflare credentials.");
    receipt.status = "uploading";
    await save();
    // No further writers or project hooks exist in this job. Extraction set
    // read-only files/directories. Only reviewed source uploader + trusted CLI.
    await assertInventory(join(artifact, "dist"), receipt.assets);
    await assertCurrentReleaseHead({ target, sourceSha }); // IMMEDIATELY before ONE upload
    try {
      await exec(
        process.execPath,
        [
          tool,
          "pages",
          "deploy",
          join(artifact, "dist"),
          `--project-name=${target.pagesProject}`,
          `--branch=${target.pagesBranch}`,
          `--commit-hash=${sourceSha}`,
          "--commit-dirty=true",
          "--no-bundle",
          "--force", // pinned CLI: Pages only, NEVER automatic Workers delegation
        ],
        {
          // Empty independent CWD: no artifact Wrangler config/functions/project hooks.
          cwd: join(
            resolve(environment.RUNNER_TEMP),
            "tasknotes-publish-tooling",
          ),
          env: {
            PATH: environment.PATH,
            HOME: environment.RUNNER_TEMP,
            CLOUDFLARE_API_TOKEN: environment.CLOUDFLARE_API_TOKEN,
            CLOUDFLARE_ACCOUNT_ID: environment.CLOUDFLARE_ACCOUNT_ID,
            WRANGLER_SEND_METRICS: "false",
            WRANGLER_OUTPUT_FILE_PATH: output,
          },
          timeout: 600000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
    } finally {
      const structured = await readFile(output, "utf8");
      if (structured.trim())
        receipt.deployment = parseWranglerDeployment(structured);
      await save(); // Actual deployment UUID saved BEFORE ANY served checks
    }
    if (!receipt.deployment?.id)
      throw new Error("Upload missing actual deployment UUID.");
    receipt.status = "uploaded";
    await save();
    // The downstream workflow step is gated on SUCCESSFUL actual UUID capture,
    // never merely on a zero uploader exit or arbitrary Pages URL.
    await appendFile(
      environment.GITHUB_OUTPUT,
      `deployment_id=${receipt.deployment.id}\n`,
    );
  } catch (error) {
    if (error.report) receipt.served = error.report;
    receipt.status = "failed";
    receipt.failure = error.message;
    await save();
    throw error; // retain failed receipt; NO retry upload/rebuild/redeploy/rollback
  }
}
export function assertCapturedDeployment({
  receipt,
  deploymentId,
  environment,
  target,
}) {
  same(
    environment.GITHUB_EVENT_NAME,
    "workflow_dispatch",
    "Captured manual event",
  );
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      deploymentId ?? "",
    )
  )
    throw new Error("Served checks require captured actual deployment UUID.");
  same(receipt.status, "uploaded", "Successful uploaded receipt capture");
  same(receipt.deployment?.id, deploymentId, "Captured deployment UUID");
  same(receipt.source?.sha, environment.NATIVE_SOURCE_SHA, "Captured source");
  same(receipt.source?.sha, environment.GITHUB_SHA, "Captured workflow source");
  same(receipt.target, createReceipt({ target }).target, "Captured target");
  same(
    receipt.run,
    {
      repository: environment.GITHUB_REPOSITORY,
      id: environment.GITHUB_RUN_ID,
      attempt: environment.GITHUB_RUN_ATTEMPT,
    },
    "Captured repository/run/attempt",
  );
}

export async function verifyCapturedUpload(environment = process.env) {
  const { target } = parsePublishRequest({
    target: environment.NATIVE_TARGET,
    sourceSha: environment.NATIVE_SOURCE_SHA,
    dispatchRef: environment.GITHUB_REF,
  });
  const evidence = resolve(environment.NATIVE_EVIDENCE_PATH, "receipt.json");
  const receipt = JSON.parse(await readFile(evidence, "utf8"));
  const save = async () =>
    writeFile(evidence, JSON.stringify(receipt, null, 2) + "\n");
  try {
    assertCapturedDeployment({
      receipt,
      deploymentId: environment.NATIVE_DEPLOYMENT_ID,
      environment,
      target,
    });
    receipt.served = await verifyServedAssets({
      origin: target.appOrigin,
      assets: receipt.assets,
    });
    if (receipt.served.failures.length)
      throw new Error("Served byte failures.");
    receipt.status = "bytes-verified-hosting-controls-unverified";
    await save();
    receipt.hostingPolicy = await verifyTrustedHostingPolicy({
      origin: target.appOrigin,
      assets: receipt.assets,
      served: receipt.served,
    });
    if (receipt.hostingPolicy.unverified.length)
      throw new Error(
        "Unknown hosting control/executed worker policy requires independent evidence; byte proof alone is incomplete.",
      );
    receipt.hostingControls = "verified-known-static-header-route-policy";
    receipt.status = "bytes-and-static-hosting-verified";
    await save();
  } catch (error) {
    if (error.report) receipt.served = error.report;
    receipt.status = "failed";
    receipt.failure = error.message;
    await save();
    throw error;
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    if (process.argv[2] === "upload") await upload();
    else if (process.argv[2] === "verify") await verifyCapturedUpload();
    else throw new Error("Usage: native-publisher-upload.mjs upload|verify");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

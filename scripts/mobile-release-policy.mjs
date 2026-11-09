import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { provenSource } from "./publisher/sdk-provenance.mjs";
import { compatible } from "./publisher/compatibility.mjs";
import {
  assertProductionTrustPin,
  assertSdkDependency,
} from "./production-sdk.mjs";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = "callumalpass/tasknotes-app";
export const OPS = "mdbase-dev/mdbase-cloud-ops";
export const REQUIRED_CONNECT = "c42d004e3";
export const WORKFLOWS = {
  android: "google-play-production.yml",
  ios: "app-store-submit.yml",
};
export const LINES = {
  android: "tasknotes-google-play",
  ios: "tasknotes-app-store",
};

export function requirePolicy(condition, reason) {
  if (!condition) throw new Error(reason);
}
export function gh(path, options = {}, evidence = false) {
  const env = { ...process.env };
  if (evidence) {
    requirePolicy(env.APP_EVIDENCE_GH_TOKEN, "ops-evidence-token-required");
    env.GH_TOKEN = env.APP_EVIDENCE_GH_TOKEN;
  }
  const args = [
    "api",
    ...(options.pages ? ["--paginate", "--slurp"] : []),
    path,
  ];
  if (options.body) args.push("--method", "POST", "--input", "-");
  try {
    return JSON.parse(
      execFileSync("gh", args, {
        encoding: "utf8",
        env,
        input: options.body && JSON.stringify(options.body),
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
  } catch {
    throw new Error("release-evidence-unavailable");
  }
}
function gitFile(source, path) {
  requirePolicy(/^[a-f0-9]{40}$/.test(source), "exact-source-required");
  return execFileSync("git", ["show", `${source}:${path}`], {
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
const jsonFile = (source, path) => JSON.parse(gitFile(source, path));
export function ancestor(repo, older, newer = "main") {
  return ["ahead", "identical"].includes(
    gh(
      `repos/${repo}/compare/${older}...${newer}?per_page=1`,
      {},
      repo !== REPO,
    ).status,
  );
}
export function latestExactGreen(runs, sha, workflow) {
  const exact = runs
    .filter(
      (r) =>
        r.head_sha === sha &&
        r.event === "push" &&
        r.head_branch === "main" &&
        r.path === `.github/workflows/${workflow}`,
    )
    .sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt);
  return exact[0]?.status === "completed" && exact[0]?.conclusion === "success";
}
export async function artifactJson(
  runId,
  name,
  filename,
  evidenceRepo = REPO,
  evidence = false,
) {
  const dir = await mkdtemp(join(tmpdir(), "tasknotes-mobile-evidence-"));
  try {
    const env = { ...process.env };
    if (evidence) env.GH_TOKEN = env.APP_EVIDENCE_GH_TOKEN;
    execFileSync(
      "gh",
      [
        "run",
        "download",
        String(runId),
        "--repo",
        evidenceRepo,
        "--name",
        name,
        "--dir",
        dir,
      ],
      {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return JSON.parse(await readFile(join(dir, filename), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function storeLine(
  platform,
  operation = "status",
  reason = "app-outcome-unknown",
) {
  requirePolicy(
    LINES[platform] && ["status", "stop"].includes(operation),
    "invalid-store-line",
  );
  const result = gh(
    `repos/${OPS}/actions/workflows/tasknotes-store-line.yml/dispatches`,
    {
      body: {
        ref: "main",
        inputs: {
          store: platform === "android" ? "google-play" : "app-store",
          operation,
          reason,
        },
        return_run_details: true,
      },
    },
    true,
  );
  requirePolicy(
    Number.isSafeInteger(result.workflow_run_id),
    "store-line-dispatch-unknown",
  );
  const id = result.workflow_run_id;
  for (let attempt = 0; attempt < 60; attempt++) {
    const run = gh(`repos/${OPS}/actions/runs/${id}`, {}, true);
    requirePolicy(
      run.path === ".github/workflows/tasknotes-store-line.yml" &&
        run.head_branch === "main" &&
        run.event === "workflow_dispatch" &&
        run.run_attempt === 1,
      "store-line-run-binding-required",
    );
    if (run.status === "completed") {
      requirePolicy(run.conclusion === "success", "store-line-read-failed");
      const state = await artifactJson(
        id,
        "tasknotes-store-line",
        "store-line.json",
        OPS,
        true,
      );
      requirePolicy(
        state.app === LINES[platform] &&
          typeof state.stopped === "boolean" &&
          typeof state.app_stopped === "boolean",
        "store-line-artifact-binding-required",
      );
      return state;
    }
    await new Promise((done) => setTimeout(done, 5000));
  }
  throw new Error("store-line-outcome-unknown");
}

export async function assertLinesOpen(platform, readLine = storeLine) {
  const state = await readLine(platform);
  requirePolicy(state.stopped === false, "store-line-stopped");
  requirePolicy(state.app_stopped === false, "app-line-stopped");
}

export async function qualifyCommit(source) {
  requirePolicy(ancestor(REPO, source), "source-not-on-main");
  for (const ci of [
    "ci.yml",
    "android.yml",
    "ios.yml",
    "production-smoke.yml",
  ]) {
    const runs = gh(
      `repos/${REPO}/actions/workflows/${ci}/runs?head_sha=${source}&branch=main&event=push&per_page=100`,
    ).workflow_runs;
    requirePolicy(latestExactGreen(runs, source, ci), "exact-main-ci-required");
  }
  const pkg = jsonFile(source, "package.json");
  const trust = assertProductionTrustPin(
    jsonFile(source, "vendor/production-trust.pin.json"),
  );
  requirePolicy(
    /^[\w.-]+\.json$/.test(trust.sdkPin ?? ""),
    "production-sdk-pin-required",
  );
  const pin = jsonFile(source, `vendor/${trust.sdkPin}`);
  requirePolicy(
    /^[\w.-]+\.tgz$/.test(pin.artifact ?? ""),
    "production-sdk-archive-required",
  );
  const archive = gitFile(source, `vendor/${pin.artifact}`);
  assertSdkDependency(trust, pin, pkg, archive);
  requirePolicy(
    pin.publication?.integrity ===
      "sha512-" + createHash("sha512").update(archive).digest("base64"),
    "sdk-publication-integrity-mismatch",
  );
  const authenticated = await provenSource("@mdbase-dev/sdk", {
    version: pin.version,
    workflow: "publish-sdk-npm.yml",
    entry: { dist: { integrity: pin.publication.integrity } },
  });
  requirePolicy(
    authenticated.commit === pin.sourceCommit,
    "authenticated-sdk-producer-mismatch",
  );
  const embedded = JSON.parse(
    execFileSync("tar", ["-xzOf", "-", "package/dist/native/provenance.json"], {
      input: archive,
      encoding: "utf8",
      maxBuffer: 65536,
      stdio: ["pipe", "pipe", "pipe"],
    }),
  );
  requirePolicy(
    embedded.schema === "mdbase-sdk/npm-publication/1" &&
      embedded.environment === "production" &&
      embedded.commit === pin.sourceCommit,
    "embedded-sdk-producer-mismatch",
  );
  requirePolicy(
    pin.environment === "production" &&
      pin.publication?.repository === "mdbase-dev/mdbase-connect" &&
      pin.publication?.workflow === ".github/workflows/publish-sdk-npm.yml" &&
      /^[a-f0-9]{40}$/.test(pin.sourceCommit ?? "") &&
      ancestor("mdbase-dev/mdbase-connect", REQUIRED_CONNECT, pin.sourceCommit),
    "required-connect-sdk-ancestry-missing",
  );
  // A candidate may not silently rotate the approved production trust asset.
  const approved = JSON.parse(
    await readFile("vendor/production-trust.pin.json", "utf8"),
  );
  requirePolicy(
    trust.trustAssetSha256 === approved.trustAssetSha256 &&
      pin.trust?.sha256 === approved.trustAssetSha256,
    "trust-change-needs-owner",
  );
  return { ...pkg, producer: pin.sourceCommit };
}

export async function qualifySource(platform, sourceRunId) {
  requirePolicy(
    WORKFLOWS[platform] && /^[1-9]\d*$/.test(String(sourceRunId)),
    "source-run-required",
  );
  const run = gh(`repos/${REPO}/actions/runs/${sourceRunId}`);
  const expected = platform === "android" ? "android.yml" : "ios-release.yml";
  requirePolicy(
    run.path === `.github/workflows/${expected}` &&
      run.repository.full_name === REPO &&
      run.head_repository.full_name === REPO &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      run.run_attempt === 1 &&
      run.event === "workflow_dispatch" &&
      run.head_branch === "main" &&
      /^[a-f0-9]{40}$/.test(run.head_sha),
    "trusted-successful-source-run-required",
  );
  const binding = await artifactJson(
    sourceRunId,
    `mobile-build-source-${platform}`,
    "mobile-build-source.json",
  );
  requirePolicy(
    binding.runId === run.id &&
      binding.platform === platform &&
      /^[a-f0-9]{40}$/.test(binding.source),
    "build-source-binding-required",
  );
  const source = binding.source;
  const pkg = await qualifyCommit(source);
  requirePolicy(
    /^\d+\.\d+\.\d+$/.test(binding.version) && binding.build === run.run_number,
    "build-version-binding-required",
  );
  const artifacts = gh(
    `repos/${REPO}/actions/runs/${sourceRunId}/artifacts?per_page=100`,
  ).artifacts;
  const builds = artifacts.filter(
    (a) =>
      !a.expired &&
      (platform === "android"
        ? a.name === `tasknotes-android-${source}`
        : /^tasknotes-ios-\d+\.\d+\.\d+-\d+$/.test(a.name)),
  );
  requirePolicy(builds.length === 1, "unique-signed-build-artifact-required");
  const artifact = builds[0];
  requirePolicy(
    /^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? ""),
    "signed-artifact-digest-required",
  );
  if (platform === "ios") {
    requirePolicy(
      artifact.name === `tasknotes-ios-${binding.version}-${run.run_number}`,
      "ios-version-build-mismatch",
    );
    const jobs = gh(
      `repos/${REPO}/actions/runs/${sourceRunId}/attempts/${run.run_attempt}/jobs?per_page=100`,
    ).jobs;
    const uploads = jobs
      .flatMap((j) => j.steps ?? [])
      .filter((s) => s.name === "Upload to TestFlight");
    requirePolicy(
      uploads.length === 1 && uploads[0].conclusion === "success",
      "testflight-upload-required",
    );
  }
  return {
    source,
    sourceRunId: run.id,
    version: binding.version,
    build: run.run_number,
    artifactDigest: artifact.digest,
    artifactName: artifact.name,
    producer: pkg.producer,
  };
}

async function main() {
  const platform = process.argv[2];
  requirePolicy(
    process.env.GITHUB_REPOSITORY === REPO &&
      process.env.GITHUB_REF === "refs/heads/main" &&
      process.env.GITHUB_RUN_ATTEMPT === "1" &&
      process.env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      process.env.GITHUB_WORKFLOW_REF ===
        `${REPO}/.github/workflows/${WORKFLOWS[platform]}@refs/heads/main`,
    "protected-first-attempt-store-context-required",
  );
  await assertLinesOpen(platform);
  const source = await qualifySource(platform, process.env.SOURCE_RUN_ID);
  if (
    !(await compatible(source.producer, {
      token: process.env.APP_EVIDENCE_GH_TOKEN,
    }))
  ) {
    await writeFile(
      "store-target-result.json",
      JSON.stringify({
        outcome: "production-contract-wait",
        source: source.source,
      }) + "\n",
    );
    await appendFile(process.env.GITHUB_ENV, "STORE_PENDING=true\n");
    return;
  }
  let block;
  if (platform === "android") {
    const { readPlayStatus, playReviewBlock } =
      await import("./store-status.mjs");
    const status = await readPlayStatus(
      process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64,
    );
    block = playReviewBlock(status);
  } else {
    const { readAppleLive } = await import("./store-status.mjs");
    const { createStatusClient } = await import("./app-store-status.mjs");
    const { appleQueueBlock } = await import("./store-cd.mjs");
    const status = await readAppleLive(
      createStatusClient({
        keyId: process.env.APP_STORE_PUBLISH_KEY_ID,
        issuerId: process.env.APP_STORE_PUBLISH_ISSUER_ID,
        privateKey: Buffer.from(
          process.env.APP_STORE_PUBLISH_PRIVATE_KEY_BASE64 ?? "",
          "base64",
        ).toString("utf8"),
      }),
    );
    block = appleQueueBlock(status.versions);
  }
  if (block === "earlier-store-version-in-flight") {
    await writeFile(
      "store-target-result.json",
      JSON.stringify({ outcome: "pending-review", source: source.source }) +
        "\n",
    );
    await appendFile(process.env.GITHUB_ENV, "STORE_PENDING=true\n");
    return;
  }
  requirePolicy(!block, block);
  await writeFile(
    "mobile-release-qualified.json",
    JSON.stringify(source, null, 2) + "\n",
  );
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
)
  main().catch((error) => {
    // Only fixed policy reasons; never command stderr or store response bodies.
    const reason = /^[a-z0-9-]+$/.test(error.message)
      ? error.message
      : "release-evidence-unavailable";
    console.error(`Mobile publication refused: ${reason}`);
    process.exitCode = 1;
  });

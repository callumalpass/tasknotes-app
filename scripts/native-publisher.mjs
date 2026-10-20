import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inventoryDirectory } from "./lib/native-publish-bytes.mjs";
import { verifyTargetIntake } from "./lib/native-publish-intake.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  developmentDeploymentEnvironment,
  developmentDeployments,
} from "./deploy-pages-dev.mjs";

import { selectServedChecks } from "./verify-native-served.mjs";
export {
  selectServedChecks,
  verifyServedAssets,
} from "./verify-native-served.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");

/**
 * Protected native publisher targets. Source comes only from the target's
 * native release ref, never from main (the TaskNotes native branch is never
 * merged to main). `pagesBranch` names the Cloudflare Pages channel only;
 * for production that is the Pages production slot, not a Git main merge.
 *
 * Exact production Editor origin is recorded in the coordinator's linked
 * native-app release plan. GitHub environment protections are configured
 * separately by the coordinator; source code cannot create those protections.
 */
export const NATIVE_PUBLISH_TARGETS = Object.freeze({
  staging: Object.freeze({
    target: "staging",
    environment: "staging",
    releaseRef: "release/native-staging",
    githubEnvironment: "staging",
    appOrigin: "https://staging.tasknotes-app.pages.dev",
    editorOrigin: "https://editor-staging.mdbase.dev",
    connectOrigin: "https://connect-staging.mdbase.dev",
    pagesProject: "tasknotes-app",
    pagesBranch: "staging",
    wranglerVersion: "4.114.0",
  }),
  production: Object.freeze({
    target: "production",
    environment: "production",
    releaseRef: "release/native-production",
    githubEnvironment: "production",
    appOrigin: "https://app.tasknotes.dev",
    editorOrigin: "https://editor.mdbase.dev",
    connectOrigin: "https://connect.mdbase.dev",
    pagesProject: "tasknotes-app",
    pagesBranch: "main",
    wranglerVersion: "4.114.0",
  }),
});

const FULL_SHA = /^[a-f0-9]{40}$/;
export const NATIVE_BASE = "153494deb68c71d37a3e99f3ef140d874145e2f1";

export function parsePublishRequest({ target, sourceSha, dispatchRef }) {
  const config = NATIVE_PUBLISH_TARGETS[target];
  if (!Object.hasOwn(NATIVE_PUBLISH_TARGETS, target)) {
    throw new Error(
      `Native publisher target must be staging or production, received ${JSON.stringify(target)}.`,
    );
  }
  if (typeof sourceSha !== "string" || !FULL_SHA.test(sourceSha)) {
    throw new Error(
      "Native publisher requires an exact full lowercase source SHA (40 hex characters); branch names and short SHAs are refused.",
    );
  }
  const expectedDispatchRef = `refs/heads/${config.releaseRef}`;
  if (dispatchRef !== expectedDispatchRef) {
    throw new Error(
      `Native ${config.target} publishes only when dispatched from ${config.releaseRef} (${expectedDispatchRef}), received ${JSON.stringify(dispatchRef)}.`,
    );
  }
  return Object.freeze({ target: config, sourceSha });
}

export async function runGit(args, cwd = projectRoot) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

export async function assertShaOnReleaseRef({
  target,
  sourceSha,
  runGit: git = runGit,
}) {
  let verified;
  try {
    verified = (
      await git(["rev-parse", "--verify", `${sourceSha}^{commit}`])
    ).trim();
  } catch {
    throw new Error(`Native publisher cannot verify ${sourceSha} as a commit.`);
  }
  if (verified !== sourceSha) {
    throw new Error(
      `Native publisher cannot verify ${sourceSha} as a commit (resolved ${verified}).`,
    );
  }
  const releaseRef = `refs/remotes/origin/${target.releaseRef}`;
  try {
    const head = (await git(["rev-parse", "--verify", releaseRef])).trim();
    if (head !== sourceSha) throw new Error("not exact release head");
  } catch {
    throw new Error(
      `Native publisher requires the exact authorized release ref head ${target.releaseRef}; refusing stale or missing source.`,
    );
  }
  try {
    await git(["merge-base", "--is-ancestor", NATIVE_BASE, sourceSha]);
    await git(["merge-base", "--is-ancestor", sourceSha, releaseRef]);
  } catch {
    throw new Error(
      `Source SHA ${sourceSha} is not on ${target.releaseRef} (not an ancestor of ${releaseRef}); refusing.`,
    );
  }
}

// Canonical ORIGINAL packet checks; never execute candidate SDK code to inspect it.
export const verifySdkTrust = verifyTargetIntake;

// --- exact build environment -------------------------------------------------

function refuseConflicting(baseEnvironment, variable, expected, target) {
  const value = baseEnvironment[variable];
  if (value !== undefined && value !== "" && value !== expected) {
    throw new Error(
      `Native ${target.target} requires ${variable}=${expected}, received ${value}.`,
    );
  }
}

export function nativeBuildEnvironment(target, baseEnvironment = {}) {
  refuseConflicting(baseEnvironment, "MDBASE_ENV", target.environment, target);
  refuseConflicting(
    baseEnvironment,
    "TASKNOTES_DEPLOY_TARGET",
    target.target,
    target,
  );
  if (baseEnvironment.VITE_TASKNOTES_ANDROID_NOTIFICATION_TEST) {
    throw new Error(
      "Native publisher refuses the test-only notification entry.",
    );
  }
  if (!target.editorOrigin) {
    throw new Error(
      `Native ${target.target} Editor origin is not configured in source (NATIVE_PUBLISH_TARGETS.${target.target}.editorOrigin); refusing to invent or reuse another environment's Editor origin.`,
    );
  }
  if (target.environment === "staging") {
    const staging = developmentDeployments.staging;
    if (
      staging.appOrigin !== target.appOrigin ||
      staging.editorOrigin !== target.editorOrigin ||
      staging.connectOrigin !== target.connectOrigin ||
      staging.project !== target.pagesProject ||
      staging.branch !== target.pagesBranch
    ) {
      throw new Error(
        "Native staging target has drifted from scripts/deploy-pages-dev.mjs staging deployment; refusing.",
      );
    }
    // Reuse the existing staging build-environment rules verbatim: exact
    // origins, LAB origin cleared, and no Connect loopback (staging has no
    // loopback authority). Conflicting inherited values refuse there.
    return developmentDeploymentEnvironment({
      ...baseEnvironment,
      MDBASE_ENV: "staging",
    });
  }
  if (target.environment !== "production") {
    throw new Error(
      `Unsupported native publisher environment: ${target.environment}.`,
    );
  }
  if (
    baseEnvironment.VITE_MDBASE_CONNECT_LOOPBACK_URL !== undefined &&
    baseEnvironment.VITE_MDBASE_CONNECT_LOOPBACK_URL !== ""
  ) {
    throw new Error(
      "Native production cannot include VITE_MDBASE_CONNECT_LOOPBACK_URL.",
    );
  }
  if (
    baseEnvironment.VITE_TASKNOTES_LAB_ORIGIN !== undefined &&
    baseEnvironment.VITE_TASKNOTES_LAB_ORIGIN !== ""
  ) {
    throw new Error(
      "Native production cannot include a LAB origin (VITE_TASKNOTES_LAB_ORIGIN).",
    );
  }
  refuseConflicting(
    baseEnvironment,
    "TASKNOTES_APP_URL",
    target.appOrigin,
    target,
  );
  refuseConflicting(
    baseEnvironment,
    "VITE_MDBASE_CONNECT_URL",
    target.connectOrigin,
    target,
  );
  refuseConflicting(
    baseEnvironment,
    "MDBASE_CONNECT_URL",
    target.connectOrigin,
    target,
  );
  refuseConflicting(
    baseEnvironment,
    "VITE_TASKNOTES_EDITOR_ORIGIN",
    target.editorOrigin,
    target,
  );
  refuseConflicting(
    baseEnvironment,
    "VITE_TASKNOTES_ENVIRONMENT",
    "production",
    target,
  );

  const environment = { ...baseEnvironment };
  delete environment.VITE_MDBASE_CONNECT_LOOPBACK_URL;
  return {
    ...environment,
    MDBASE_ENV: "production",
    VITE_BASE_PATH: "/",
    VITE_TASKNOTES_ENVIRONMENT: "production",
    VITE_TASKNOTES_LAB_ORIGIN: "",
    VITE_TASKNOTES_EDITOR_ORIGIN: target.editorOrigin,
    TASKNOTES_APP_URL: target.appOrigin,
    TASKNOTES_WEB_ONLY: "1",
    TASKNOTES_FIREBASE_PROJECT_ID:
      baseEnvironment.TASKNOTES_FIREBASE_PROJECT_ID ?? "",
    VITE_MDBASE_CONNECT_URL: target.connectOrigin,
  };
}

export function assertBuiltManifest({ manifest, target }) {
  const callback = `${target.appOrigin}/auth/mdbase/callback`;
  const installationOrigins =
    manifest.installation_origins?.[target.environment]?.["app-runtime"] ?? [];
  if (
    manifest.homepage !== `${target.appOrigin}/` ||
    manifest.icon !== `${target.appOrigin}/icon.png` ||
    manifest.redirect_uris?.length !== 1 ||
    manifest.redirect_uris[0] !== callback ||
    installationOrigins.length !== 1 ||
    installationOrigins[0] !== target.appOrigin
  ) {
    throw new Error(
      `Built manifest does not declare exact native ${target.target} origin ${target.appOrigin} (homepage, icon, single redirect URI and installation_origins.${target.environment}); refusing upload.`,
    );
  }
}

// --- asset inventory and receipt ----------------------------------------------

export const buildAssetInventory = inventoryDirectory;

export function createReceipt({
  target,
  sourceSha,
  sourceTree,
  sdkTrust,
  assets,
  deployment,
}) {
  return Object.freeze({
    schema_version: 1,
    kind: "tasknotes-native-pages-publish",
    app: "tasknotes",
    source: Object.freeze({ sha: sourceSha, tree: sourceTree }),
    target: Object.freeze({
      name: target.target,
      releaseRef: target.releaseRef,
      githubEnvironment: target.githubEnvironment,
      appOrigin: target.appOrigin,
      editorOrigin: target.editorOrigin,
      connectOrigin: target.connectOrigin,
      trustEnvironment: target.environment,
      pagesProject: target.pagesProject,
      pagesBranch: target.pagesBranch,
    }),
    sdkTrust,
    assets,
    deployment: deployment
      ? Object.freeze({
          id: deployment.id ?? null,
          url: deployment.url ?? null,
        })
      : null,
  });
}

export function parseWranglerDeployment(output) {
  // Wrangler 4.114.0 WRANGLER_OUTPUT_FILE_PATH JSONL, not the short URL prefix
  // (which is NOT a Pages deployment ID).
  const rows = output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const row = rows.findLast(
    (entry) =>
      entry.type === "pages-deploy-detailed" || entry.type === "pages-deploy",
  );
  if (
    row?.pages_project !== "tasknotes-app" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      row?.deployment_id ?? "",
    ) ||
    !/^https:\/\/[a-z0-9]+\.tasknotes-app\.pages\.dev\/?$/.test(row?.url ?? "")
  ) {
    throw new Error(
      "Wrangler structured output carries no tasknotes-app deployment ID/URL.",
    );
  }
  return Object.freeze({ id: row.deployment_id, url: row.url });
}

export async function assertCheckout({
  target,
  sourceSha,
  workflowSha,
  git = runGit,
  clean = true,
}) {
  if (
    workflowSha !== sourceSha ||
    (await git(["rev-parse", "HEAD"])).trim() !== sourceSha
  ) {
    throw new Error(
      "Requested source must equal exact checkout and dispatch workflow SHA.",
    );
  }
  await assertShaOnReleaseRef({ target, sourceSha, runGit: git });
  if (
    clean &&
    (await git(["status", "--porcelain", "--untracked-files=all"])).trim()
  ) {
    throw new Error("Native publisher requires a clean exact checkout.");
  }
}

export async function assertBuiltTrust({ directory, assets, sdkTrust }) {
  selectServedChecks(assets);
  for (const expected of [
    sdkTrust.sdk.native.sha256,
    sdkTrust.sdk.native.sqliteSha256,
  ]) {
    if (
      !assets.some(
        (asset) => asset.path.endsWith(".wasm") && asset.sha256 === expected,
      )
    ) {
      throw new Error(
        "Built native/SQLite WASM does not match authenticated SDK input.",
      );
    }
  }
  if (
    !assets.some(
      (asset) =>
        /\.js$/.test(asset.path) &&
        asset.sha256 === sdkTrust.sdk.native.sqliteInitializerSha256,
    )
  )
    throw new Error(
      "Built SQLite initializer does not match original SDK bytes.",
    );
  const trustAssets = [];
  for (const asset of assets.filter((entry) => /\.(m?js)$/.test(entry.path))) {
    const code = await readFile(join(directory, asset.path), "utf8");
    if (code.includes(sdkTrust.sdk.trust.sha256)) trustAssets.push(asset.path);
  }
  if (!trustAssets.length)
    throw new Error(
      "Built JavaScript is missing the authenticated packaged trust asset hash.",
    );
  return trustAssets;
}

async function run(command, args, environment) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: environment,
    stdio: "inherit",
  });
  await new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? accept() : reject(new Error(`${command} exited ${code}.`)),
    );
  });
}

export async function guard(environment, installed = false) {
  if (environment.GITHUB_EVENT_NAME !== "workflow_dispatch")
    throw new Error("Native publisher requires manual workflow_dispatch.");
  const request = parsePublishRequest({
    target: environment.NATIVE_TARGET,
    sourceSha: environment.NATIVE_SOURCE_SHA,
    dispatchRef: environment.GITHUB_REF,
  });
  await assertCheckout({ ...request, workflowSha: environment.GITHUB_SHA });
  const buildEnvironment = nativeBuildEnvironment(request.target, environment);
  const sdkTrust = await verifyTargetIntake({
    root: projectRoot,
    target: request.target,
    installed,
  });
  return { ...request, buildEnvironment, sdkTrust };
}

export async function nativePublisherCli(command, environment = process.env) {
  if (!["guard", "guard-installed", "prepare"].includes(command))
    throw new Error(
      "Usage: native-publisher.mjs guard|guard-installed|prepare (upload is separate).",
    );
  const { target, sourceSha, buildEnvironment, sdkTrust } = await guard(
    environment,
    command !== "guard",
  );
  if (command !== "prepare") return;
  // Only after original archives + frozen lock + EVERY installed member passed.
  const { appReleaseTrust } = await import(
    pathToFileURL(
      join(
        projectRoot,
        "node_modules/@mdbase-dev/sdk/dist/application/packaged-trust.js",
      ),
    ).href
  );
  const compiled = appReleaseTrust();
  if (
    compiled.assetSha256 !== sdkTrust.sdk.trust.sha256 ||
    compiled.environment !== target.environment ||
    compiled.cpOrigin !== target.connectOrigin ||
    compiled.logOrigin !== sdkTrust.sdk.trust.logOrigin
  )
    throw new Error("Compiled appReleaseTrust target/ASSET mismatch.");
  const sourceTree = (await runGit(["rev-parse", "HEAD^{tree}"])).trim();
  await run("pnpm", ["build"], buildEnvironment); // exactly one build, NO environment/secrets
  await run(
    "node",
    ["scripts/validate-manifest.mjs", "dist/.well-known/mdbase-app.json"],
    buildEnvironment,
  );
  const directory = join(projectRoot, "dist");
  assertBuiltManifest({
    manifest: JSON.parse(
      await readFile(join(directory, ".well-known/mdbase-app.json"), "utf8"),
    ),
    target,
  });
  // Offline-shell plugin + static routes have FINISHED. Inventory EVERY final
  // file, including dotfiles, underscore controls, worker/SDK bits, no filters.
  const assets = await inventoryDirectory(directory);
  const trustAssets = await assertBuiltTrust({ directory, assets, sdkTrust });
  const output = resolve(environment.NATIVE_ARTIFACT_PATH);
  if (output.startsWith(projectRoot + "/"))
    throw new Error("Artifact must be outside source.");
  await mkdir(output, { recursive: true });
  const { cp } = await import("node:fs/promises");
  await cp(directory, join(output, "dist"), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await writeFile(
    join(output, "receipt.json"),
    JSON.stringify(
      {
        ...createReceipt({ target, sourceSha, sourceTree, sdkTrust, assets }),
        trustAssets,
        run: {
          repository: environment.GITHUB_REPOSITORY,
          id: environment.GITHUB_RUN_ID,
          attempt: environment.GITHUB_RUN_ATTEMPT,
        },
        status: "prepared",
        hostingControls: "unverified",
      },
      null,
      2,
    ) + "\n",
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    await nativePublisherCli(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

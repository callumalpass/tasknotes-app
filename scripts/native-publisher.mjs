import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  developmentDeploymentEnvironment,
  developmentDeployments,
} from "./deploy-pages-dev.mjs";

import {
  selectServedChecks,
  verifyServedAssets,
} from "./verify-native-served.mjs";
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
const SHA256 = /^[a-f0-9]{64}$/;
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

// --- authenticated target SDK archive guard ---------------------------------
//
// The SDK input must be the target environment's authenticated archive. The
// repository convention is a `file:vendor/*.tgz` pin in package.json with a
// companion `vendor/*.json` beside it carrying the archive sha256 and the
// release trust (environment + CP origin). Until a staging/production
// archive exists this refuses before upload; the LAB archive is never
// retargeted.

function vendorArchive(packageJson, name) {
  const spec = packageJson.dependencies?.[name];
  if (
    typeof spec !== "string" ||
    !/^file:vendor\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/.test(spec)
  ) {
    throw new Error(
      `Native publisher requires ${name} pinned as file:vendor/*.tgz, received ${JSON.stringify(spec)}.`,
    );
  }
  const path = spec.slice("file:".length);
  return { path, companionPath: path.replace(/\.tgz$/, ".json") };
}

async function verifiedArchive({
  name,
  archive,
  readCompanion,
  hashFile,
  expectedHash,
}) {
  let companion;
  try {
    companion = await readCompanion(archive.companionPath);
  } catch (error) {
    throw new Error(
      `Native publisher cannot read companion metadata for ${name} at ${archive.companionPath}: ${error.message}`,
      { cause: error },
    );
  }
  if (companion.artifact && companion.artifact !== basename(archive.path)) {
    throw new Error(
      `${name} companion describes ${companion.artifact} but package.json pins ${basename(archive.path)}.`,
    );
  }
  if (companion.noPublication === true) {
    throw new Error(
      `${name} archive ${archive.path} is marked noPublication and is not a publication input.`,
    );
  }
  if (!SHA256.test(companion.sha256) || !SHA256.test(expectedHash ?? "")) {
    throw new Error(
      `${name} requires a sha256 and independently approved protected-environment archive hash.`,
    );
  }
  if (companion.sha256 !== expectedHash) {
    throw new Error(
      `${name} archive hash does not match the protected-environment approved original.`,
    );
  }
  const actual = await hashFile(archive.path);
  if (actual.sha256 !== companion.sha256) {
    throw new Error(
      `${name} archive sha256 hash mismatch: companion ${companion.sha256}, actual ${actual.sha256}.`,
    );
  }
  if (companion.bytes !== undefined && actual.bytes !== companion.bytes) {
    throw new Error(
      `${name} archive byte count mismatch: companion ${companion.bytes}, actual ${actual.bytes}.`,
    );
  }
  return companion;
}

export async function verifySdkTrust({
  target,
  packageJson,
  readCompanion,
  hashFile,
  readMember = readArchiveMember,
  approvedHashes = {},
}) {
  const sdkArchive = vendorArchive(packageJson, "@mdbase-dev/sdk");
  const uiArchive = vendorArchive(packageJson, "@mdbase-dev/ui");
  const protocolArchive = vendorArchive(
    packageJson,
    "@mdbase-dev/connect-protocol",
  );

  const sdk = await verifiedArchive({
    name: "@mdbase-dev/sdk",
    archive: sdkArchive,
    readCompanion,
    hashFile,
    expectedHash: approvedHashes.sdk,
  });
  const ui = await verifiedArchive({
    name: "@mdbase-dev/ui",
    archive: uiArchive,
    readCompanion,
    hashFile,
    expectedHash: approvedHashes.ui,
  });

  const trust = sdk.trust;
  if (!trust || typeof trust !== "object") {
    throw new Error(
      `SDK archive ${sdkArchive.path} carries no release trust; refusing ${target.target} publish.`,
    );
  }
  if (trust.environment !== target.environment) {
    throw new Error(
      `SDK trust environment is ${JSON.stringify(trust.environment)} but target ${target.target} requires trust for ${target.environment}; never retarget another environment's archive.`,
    );
  }
  if (trust.cpOrigin !== target.connectOrigin) {
    throw new Error(
      `SDK trust cpOrigin (Connect origin) is ${JSON.stringify(trust.cpOrigin)} but target ${target.target} requires ${target.connectOrigin}.`,
    );
  }
  if (
    !SHA256.test(sdk.native?.sha256 ?? "") ||
    !SHA256.test(sdk.native?.sqliteSha256 ?? "")
  ) {
    throw new Error(
      `SDK archive ${sdkArchive.path} carries no native runtime sha256; refusing.`,
    );
  }

  const protocol = sdk.protocol;
  if (
    !protocol?.artifact ||
    !SHA256.test(protocol?.sha256 ?? "") ||
    protocol.sha256 !== approvedHashes.protocol
  ) {
    throw new Error(
      `SDK companion carries no protocol artifact hash; refusing ${target.target} publish.`,
    );
  }
  if (protocol.artifact !== basename(protocolArchive.path)) {
    throw new Error(
      `SDK protocol artifact is ${protocol.artifact} but package.json pins ${basename(protocolArchive.path)}.`,
    );
  }
  const protocolActual = await hashFile(protocolArchive.path);
  if (protocolActual.sha256 !== protocol.sha256) {
    throw new Error(
      `Connect protocol archive sha256 hash mismatch: SDK companion ${protocol.sha256}, actual ${protocolActual.sha256}.`,
    );
  }

  const sdkSource = sdk.sourceCommit ?? sdk.packagedFromCommit;
  if (!FULL_SHA.test(sdkSource ?? "") || ui.pairedSdkSource !== sdkSource) {
    throw new Error(
      `UI archive is paired with SDK source ${ui.pairedSdkSource} but the pinned SDK source is ${sdkSource}.`,
    );
  }

  // A companion label alone is not environment authority. The independent
  // approved original archive hash comes from the protected target environment.
  // Recheck its actual packaged provenance, trust module and WASM members.
  const provenance = await verifyPackagedTrust({
    sdk,
    target,
    archive: sdkArchive.path,
    readMember,
  });
  return Object.freeze({
    provenance,
    sdk: Object.freeze({
      package: sdk.package ?? "@mdbase-dev/sdk",
      artifact: sdkArchive.path,
      sha256: sdk.sha256,
      bytes: sdk.bytes ?? null,
      sourceCommit: sdkSource ?? null,
      trust: Object.freeze({
        environment: trust.environment,
        cpOrigin: trust.cpOrigin,
        logOrigin: trust.logOrigin ?? null,
        sha256: trust.sha256,
        packagedTrustSha256: trust.packagedTrustSha256,
        sourceCommit: trust.sourceCommit,
        contextSha256: trust.contextSha256,
        receiptSha256: trust.receiptSha256,
        provenanceSha256: trust.provenanceSha256,
      }),
      native: Object.freeze({
        sha256: sdk.native.sha256,
        sqliteSha256: sdk.native.sqliteSha256 ?? null,
      }),
    }),
    ui: Object.freeze({
      package: ui.package ?? "@mdbase-dev/ui",
      artifact: uiArchive.path,
      sha256: ui.sha256,
      bytes: ui.bytes ?? null,
      sourceCommit: ui.sourceCommit ?? null,
    }),
    protocol: Object.freeze({
      artifact: protocolArchive.path,
      sha256: protocol.sha256,
      bytes: protocol.bytes ?? protocolActual.bytes,
      sourceCommit: protocol.sourceCommit ?? null,
    }),
  });
}

export async function hashVendorFile(path) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(resolve(projectRoot, path))) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), bytes };
}

export async function readVendorCompanion(path) {
  return JSON.parse(await readFile(resolve(projectRoot, path), "utf8"));
}

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

export async function buildAssetInventory(directory) {
  const assets = [];
  async function walk(current, prefix) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Built asset ${path} is a symlink; refusing to inventory it.`,
        );
      }
      if (entry.isDirectory()) {
        await walk(absolute, path);
      } else if (entry.isFile()) {
        const hash = createHash("sha256");
        let bytes = 0;
        for await (const chunk of createReadStream(absolute)) {
          bytes += chunk.length;
          hash.update(chunk);
        }
        assets.push(Object.freeze({ path, bytes, sha256: hash.digest("hex") }));
      }
    }
  }
  await walk(directory, "");
  assets.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return assets;
}

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
    !/^[a-f0-9-]{36}$/.test(row?.deployment_id ?? "") ||
    !/^https:\/\/[a-z0-9]+\.tasknotes-app\.pages\.dev\/?$/.test(row?.url ?? "")
  ) {
    throw new Error(
      "Wrangler structured output carries no tasknotes-app deployment ID/URL.",
    );
  }
  return Object.freeze({ id: row.deployment_id, url: row.url });
}

export async function readArchiveMember(archive, member) {
  // Read fixed members without extracting or executing the SDK. No eval/import
  // of generated trust code and no archive path supplied by metadata.
  const { stdout } = await execFileAsync(
    "tar",
    ["xOf", resolve(projectRoot, archive), member],
    {
      encoding: "buffer",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  return stdout;
}

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function verifyPackagedTrust({
  sdk,
  target,
  archive,
  readMember,
}) {
  const trust = sdk.trust;
  for (const field of [
    "sha256",
    "packagedTrustSha256",
    "contextSha256",
    "receiptSha256",
    "provenanceSha256",
  ]) {
    if (!SHA256.test(trust[field] ?? ""))
      throw new Error(`SDK trust missing authenticated ${field}.`);
  }
  if (
    !FULL_SHA.test(trust.sourceCommit ?? "") ||
    new URL(trust.logOrigin).protocol !== "https:"
  ) {
    throw new Error(
      "SDK trust requires authenticated source and HTTPS log origin.",
    );
  }
  const raw = await readMember(archive, "package/dist/native/provenance.json");
  const provenance = JSON.parse(raw.toString());
  if (
    digest(raw) !== trust.provenanceSha256 ||
    provenance.schema !== "mdbn-sdk/application-assets/1" ||
    provenance.environment !== target.environment
  ) {
    throw new Error("Packaged provenance hash/environment mismatch.");
  }
  for (const field of [
    "environment",
    "cpOrigin",
    "logOrigin",
    "sha256",
    "sourceCommit",
  ]) {
    if (provenance.trust?.[field] !== trust[field])
      throw new Error(`Packaged trust ${field} mismatch.`);
  }
  const handoff = provenance.handoff;
  if (
    handoff?.contextSha256 !== trust.contextSha256 ||
    handoff?.receiptSha256 !== trust.receiptSha256 ||
    provenance.verifier?.clockOverride !== false ||
    !SHA256.test(provenance.verifier?.sha256 ?? "")
  ) {
    throw new Error(
      "Missing authenticated trust handoff/verifier or forbidden clock override.",
    );
  }
  const proofs = [
    "image-release-bundle.json",
    "image-release-bundle.sigstore.json",
    "release-trust-bundle.json",
    "release-trust-bundle.sigstore.json",
  ];
  if (proofs.some((name) => !SHA256.test(handoff.proof_sha256?.[name] ?? ""))) {
    throw new Error("Missing authenticated trust publication proof hashes.");
  }
  const module = await readMember(
    archive,
    "package/dist/application/packaged-trust.js",
  );
  // Producer-generated literal, parsed as data, never executed by publisher.
  const literal = module.toString().match(/const metadata = (\{[^\n]+\});/);
  const metadata = literal ? JSON.parse(literal[1]) : null;
  if (
    digest(module) !== trust.packagedTrustSha256 ||
    metadata?.schema !== "mdbn-app-trust/release/1" ||
    metadata?.environment !== target.environment ||
    metadata?.cpOrigin !== target.connectOrigin ||
    metadata?.logOrigin !== trust.logOrigin ||
    metadata?.assetSha256 !== trust.sha256 ||
    metadata?.source?.commit !== trust.sourceCommit
  ) {
    throw new Error(
      "Actual packaged trust module hash/environment/CP mismatch.",
    );
  }
  for (const [name, expected] of [
    ["runtime", sdk.native.sha256],
    ["sqlite3", sdk.native.sqliteSha256],
  ]) {
    const bytes = await readMember(archive, `package/dist/native/${name}.wasm`);
    const record = name === "runtime" ? provenance.runtime : provenance.sqlite;
    if (
      digest(bytes) !== expected ||
      record?.sha256 !== expected ||
      record?.bytes !== bytes.length
    ) {
      throw new Error(`Packaged ${name} WASM hash/length mismatch.`);
    }
  }
  return provenance;
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

async function guard(environment) {
  if (environment.GITHUB_EVENT_NAME !== "workflow_dispatch")
    throw new Error("Native publisher requires manual workflow_dispatch.");
  const request = parsePublishRequest({
    target: environment.NATIVE_TARGET,
    sourceSha: environment.NATIVE_SOURCE_SHA,
    dispatchRef: environment.GITHUB_REF,
  });
  await assertCheckout({ ...request, workflowSha: environment.GITHUB_SHA });
  const buildEnvironment = nativeBuildEnvironment(request.target, environment);
  const sdkTrust = await verifySdkTrust({
    target: request.target,
    packageJson: JSON.parse(
      await readFile(join(projectRoot, "package.json"), "utf8"),
    ),
    readCompanion: readVendorCompanion,
    hashFile: hashVendorFile,
    approvedHashes: {
      sdk: environment.NATIVE_SDK_SHA256,
      ui: environment.NATIVE_UI_SHA256,
      protocol: environment.NATIVE_PROTOCOL_SHA256,
    },
  });
  return { ...request, buildEnvironment, sdkTrust };
}

export async function nativePublisherCli(command, environment = process.env) {
  if (!["guard", "prepare", "publish"].includes(command))
    throw new Error("Usage: native-publisher.mjs guard|prepare|publish");
  const receiptPath = resolve(
    environment.NATIVE_RECEIPT_PATH ?? "native-publisher-receipt.json",
  );
  if (receiptPath.startsWith(`${projectRoot}/`))
    throw new Error("Receipt must be outside the clean source checkout.");
  const save = async (receipt) => {
    await mkdir(resolve(receiptPath, ".."), { recursive: true });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  };
  if (command === "guard" || command === "prepare") {
    const { target, sourceSha, buildEnvironment, sdkTrust } =
      await guard(environment);
    if (command === "guard") return;
    const sourceTree = (await runGit(["rev-parse", "HEAD^{tree}"])).trim();
    await run("pnpm", ["build"], buildEnvironment); // exactly one build
    // Strict canonical validator from the pinned protocol, never allow-local.
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
    const assets = await buildAssetInventory(directory);
    const trustAssets = await assertBuiltTrust({ directory, assets, sdkTrust });
    await save({
      ...createReceipt({ target, sourceSha, sourceTree, sdkTrust, assets }),
      trustAssets,
      status: "prepared",
    });
    return;
  }
  const { target, sourceSha } = parsePublishRequest({
    target: environment.NATIVE_TARGET,
    sourceSha: environment.NATIVE_SOURCE_SHA,
    dispatchRef: environment.GITHUB_REF,
  });
  if (environment.GITHUB_EVENT_NAME !== "workflow_dispatch")
    throw new Error("Manual dispatch required.");
  await assertCheckout({
    target,
    sourceSha,
    workflowSha: environment.GITHUB_SHA,
    clean: false,
  });
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  if (
    receipt.status !== "prepared" ||
    receipt.source.sha !== sourceSha ||
    JSON.stringify(receipt.target) !==
      JSON.stringify(createReceipt({ target }).target) ||
    receipt.source.tree !== (await runGit(["rev-parse", "HEAD^{tree}"])).trim()
  ) {
    throw new Error(
      "Prepared receipt source/target mismatch or already attempted publication.",
    );
  }
  const assets = await buildAssetInventory(join(projectRoot, "dist"));
  if (JSON.stringify(assets) !== JSON.stringify(receipt.assets))
    throw new Error("Build changed after inventory; refusing upload.");
  if (!environment.CLOUDFLARE_API_TOKEN || !environment.CLOUDFLARE_ACCOUNT_ID)
    throw new Error("Missing Cloudflare credentials.");
  const outputPath = `${receiptPath}.wrangler.jsonl`;
  // Must not accidentally consume output from a previous upload.
  await writeFile(outputPath, "", { flag: "wx" });
  receipt.status = "uploading";
  await save(receipt);
  try {
    try {
      await run(
        "pnpm",
        [
          "dlx",
          `wrangler@${target.wranglerVersion}`,
          "pages",
          "deploy",
          "dist",
          `--project-name=${target.pagesProject}`,
          `--branch=${target.pagesBranch}`,
          `--commit-hash=${sourceSha}`,
          "--commit-dirty=true",
        ],
        { ...environment, WRANGLER_OUTPUT_FILE_PATH: outputPath },
      );
    } finally {
      const output = await readFile(outputPath, "utf8");
      if (output.trim()) receipt.deployment = parseWranglerDeployment(output);
      await save(receipt);
    }
    if (!receipt.deployment?.id)
      throw new Error(
        "Upload has no deployment ID; cannot issue a successful receipt.",
      );
    receipt.status = "uploaded";
    await save(receipt);
    receipt.served = await verifyServedAssets({
      origin: target.appOrigin,
      assets,
    });
    receipt.status = "verified";
    await save(receipt);
  } catch (error) {
    receipt.status = "failed";
    receipt.failure = error.message;
    await save(receipt);
    throw error; // failed receipt, never an automatic rollback/redeploy
  }
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

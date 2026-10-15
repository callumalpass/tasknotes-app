import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Caller-supplied PUBLIC build receipt. The producer must independently verify
 * signed stack inputs before archiving the SDK. No runtime receipt/root loading. */
export function readLocalSdkReceipt(root = resolve(import.meta.dirname, "..")) {
  const value = JSON.parse(
    readFileSync(resolve(root, "vendor/local-sdk-input.json"), "utf8"),
  );
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schema !== "tasknotes/local-sdk-build/1" ||
    typeof value.archive !== "string" ||
    !/^vendor\/sdk-local-[a-z0-9-]+\.tgz$/.test(value.archive) ||
    typeof value.sourceCommit !== "string" ||
    !/^[0-9a-f]{40}$/.test(value.sourceCommit) ||
    [value.archiveSha256, value.trustAssetSha256, value.runtimeSha256].some(
      (x) => typeof x !== "string" || !/^[0-9a-f]{64}$/.test(x),
    )
  )
    throw Error("Local SDK public build receipt refused.");
  return Object.freeze(value);
}

export function prepareLocalSdk(root = resolve(import.meta.dirname, "..")) {
  const receipt = readLocalSdkReceipt(root);
  const archive = resolve(root, receipt.archive);
  const bytes = readFileSync(archive);
  if (
    createHash("sha256").update(bytes).digest("hex") !== receipt.archiveSha256
  )
    throw Error("Local SDK archive qualification refused.");
  const parent = resolve(root, ".local-rehearsal-sdk");
  mkdirSync(parent, { recursive: true });
  // Every compile re-extracts the qualified archive, not mutable cached JS.
  const target = mkdtempSync(resolve(parent, "input-"));
  execFileSync(
    "tar",
    ["-xzf", archive, "-C", target, "--no-same-owner", "--no-same-permissions"],
    { stdio: "pipe" },
  );
  const sdk = resolve(target, "package");
  // The archive bundles the protocol, but noble remains an ordinary locked
  // dependency. Resolve it through the installed managed SDK's exact same
  // dependency closure rather than weakening bundler resolution/externalizing.
  const installed = resolve(
    dirname(fileURLToPath(import.meta.resolve("@mdbase-dev/sdk"))),
    "..",
  );
  const installedPackage = JSON.parse(
    readFileSync(resolve(installed, "package.json"), "utf8"),
  );
  const localPackage = JSON.parse(
    readFileSync(resolve(sdk, "package.json"), "utf8"),
  );
  for (const name of ["@noble/ciphers", "@noble/curves", "@noble/hashes"])
    if (installedPackage.dependencies[name] !== localPackage.dependencies[name])
      throw Error("Local SDK dependency qualification refused.");
  mkdirSync(resolve(sdk, "node_modules"), { recursive: true });
  symlinkSync(
    resolve(installed, "../../@noble"),
    resolve(sdk, "node_modules/@noble"),
    "dir",
  );
  const flag = readFileSync(
    resolve(sdk, "dist/local-build.js"),
    "utf8",
  );
  const provenance = JSON.parse(
    readFileSync(resolve(sdk, "dist/native/provenance.local.json"), "utf8"),
  );
  const runtime = readFileSync(resolve(sdk, "dist/native/runtime-local.wasm"));
  if (
    !flag.includes("export const LOCAL_APPLICATION_BUILD = true;") ||
    provenance.environment !== "local" ||
    provenance.trust.assetSha256 !== receipt.trustAssetSha256 ||
    createHash("sha256").update(runtime).digest("hex") !== receipt.runtimeSha256
  )
    throw Error("Local SDK compiled inputs refused.");
  return sdk;
}

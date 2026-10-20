// LOCAL/remote-builder consumer qualification, NOT a GitHub dispatch or upload.
// No fake GitHub context, clean-source bypass, credentials or publisher fallback.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyOriginalIntake } from "./lib/native-publish-intake.mjs";
import {
  NATIVE_PUBLISH_TARGETS,
  nativeBuildEnvironment,
  assertBuiltManifest,
  assertBuiltTrust,
} from "./native-publisher.mjs";
import { inventoryDirectory } from "./lib/native-publish-bytes.mjs";
const root = resolve(import.meta.dirname, "..");
const target = NATIVE_PUBLISH_TARGETS.staging;
// Independently approved Co/TNAPP/NX-TRUST handoff, not read from the candidate.
const approvedHashes = Object.freeze({
  sdk: "c0bc377606df159d03c668923b7626f31459a1750ae0db033bb42789532c7296",
  ui: "e3da3c19b49ee90d3d19df2ea4a1a387b158decfccc8000371f93170eb30b723",
  protocol: "cd1e15236ab7e25c511a4ba13af6a9df23f4b41715161479bba97b0445e1c138",
  asset: "67e117646c9c26927f0d5a44cbd26f057c318975032e9cd24f24b020150cdbc7",
});
const mode = process.argv[2];
if (!["check", "test", "build"].includes(mode))
  throw new Error("Usage: qualify-native-staging.mjs check|test|build");
// Byte/data checks, including d313 public facts + EVERY installed member,
// MUST finish before any SDK module/Vitest/Vite candidate code executes.
const sdkTrust = await verifyOriginalIntake({
  root,
  target,
  approvedHashes,
  installed: true,
});
console.log(
  JSON.stringify({
    kind: "staging-original-byte-custody-NOT-publication-or-admission",
    approvedHashes,
    originalMemberCounts: sdkTrust.originalMemberCounts,
    publicFactsSha256:
      "d313bb9dc2e291f957a77fa0c05fdff533a4cb79afa8973d63bca75c7897b44c",
    publicationConstraints: sdkTrust.publicationConstraints,
  }),
);
const { appReleaseTrust } = await import(
  pathToFileURL(
    join(
      root,
      "node_modules/@mdbase-dev/sdk/dist/application/packaged-trust.js",
    ),
  ).href
);
const compiled = appReleaseTrust();
if (
  compiled.assetSha256 !== approvedHashes.asset ||
  compiled.environment !== "staging" ||
  compiled.cpOrigin !== target.connectOrigin ||
  compiled.logOrigin !== "https://log-staging.mdbase.dev"
)
  throw new Error(
    "Compiled appReleaseTrust does not match independent STAGING tuple.",
  );
console.log(
  JSON.stringify({
    compiledRelease: {
      environment: compiled.environment,
      cpOrigin: compiled.cpOrigin,
      logOrigin: compiled.logOrigin,
      assetSha256: compiled.assetSha256,
    },
    moduleSha256: sdkTrust.sdk.trust.packagedTrustSha256,
  }),
);
const environment = nativeBuildEnvironment(target, process.env);
if (environment.VITE_MDBASE_CONNECT_LOOPBACK_URL)
  throw new Error("Staging loopback refuses.");
if (mode !== "check") {
  const child = spawn("pnpm", [mode === "test" ? "test" : "build"], {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });
  await new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? accept()
        : reject(new Error(`Consumer ${mode} exited ${code}`)),
    );
  });
}
if (mode === "build") {
  const directory = join(root, "dist");
  assertBuiltManifest({
    target,
    manifest: JSON.parse(
      await readFile(join(directory, ".well-known/mdbase-app.json"), "utf8"),
    ),
  });
  const assets = await inventoryDirectory(directory);
  const trustAssets = await assertBuiltTrust({ directory, assets, sdkTrust });
  const report = {
    kind: "UNPRIVILEGED-staging-app-build-NOT-dispatch-or-admission",
    target,
    approvedHashes,
    originalMemberCounts: sdkTrust.originalMemberCounts,
    publicationConstraints: sdkTrust.publicationConstraints,
    assets,
    trustAssets,
  };
  await mkdir(join(root, "test-results"), { recursive: true });
  await writeFile(
    join(root, "test-results/native-staging-qualification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      builtInventoryFiles: assets.length,
      trustAssets,
      publicationConstraints: sdkTrust.publicationConstraints,
    }),
  );
}

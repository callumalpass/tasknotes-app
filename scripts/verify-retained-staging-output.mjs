// DATA-ONLY post-verification of the ONE b98 build. Never builds or dispatches.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  assertInventory,
  inventoryDirectory,
} from "./lib/native-publish-bytes.mjs";
import { verifyOriginalIntake } from "./lib/native-publish-intake.mjs";
import {
  NATIVE_PUBLISH_TARGETS,
  assertBuiltManifest,
  assertBuiltTrust,
} from "./native-publisher.mjs";
import { selectServedChecks } from "./verify-native-served.mjs";
import { parseEmbeddedOfflineShell } from "./lib/native-offline-shell.mjs";
import { selectServedChecks as oldSelector } from "./fixtures/native-served-selector-before-offline-fix.mjs";
const root = resolve(import.meta.dirname, ".."),
  directory = join(root, "dist");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const raw = await readFile(
  join(root, "config/native-publish/retained-staging-build.json"),
);
assert.equal(
  hash(raw),
  "a031415551c9bc7d9aaf1424f8f36fcc8c640c5094daf028da7984df5c911060",
);
const expected = JSON.parse(raw).assets;
const inputs = JSON.parse(
  await readFile(
    join(root, "config/native-publish/retained-staging-build-inputs.json"),
  ),
);
for (const file of inputs.files) {
  const bytes = await readFile(join(root, file.path));
  assert.equal(bytes.length, file.bytes, file.path);
  assert.equal(hash(bytes), file.sha256, file.path);
}
const pkg = JSON.parse(await readFile(join(root, "package.json")));
delete pkg.scripts["test:staging-retained-output"]; // ONLY additive post-check script is non-build input
assert.deepEqual(pkg, inputs.package);
const target = NATIVE_PUBLISH_TARGETS.staging;
const sdkTrust = await verifyOriginalIntake({
  root,
  target,
  installed: true,
  approvedHashes: {
    sdk: "c0bc377606df159d03c668923b7626f31459a1750ae0db033bb42789532c7296",
    ui: "e3da3c19b49ee90d3d19df2ea4a1a387b158decfccc8000371f93170eb30b723",
    protocol:
      "cd1e15236ab7e25c511a4ba13af6a9df23f4b41715161479bba97b0445e1c138",
    asset: "67e117646c9c26927f0d5a44cbd26f057c318975032e9cd24f24b020150cdbc7",
  },
});
await assertInventory(directory, expected);
const mode = process.argv[2] ?? "green";
if (!["red", "green"].includes(mode)) throw new Error("Use red|green");
console.log(
  JSON.stringify({
    phase: "BEFORE",
    mode,
    originalBuildSource: inputs.source,
    originalBuildTree: inputs.tree,
    inputFiles: inputs.files.length,
    files: expected.length,
    bytes: expected.reduce((s, f) => s + f.bytes, 0),
    originalMembers: sdkTrust.originalMemberCounts,
  }),
);
try {
  if (mode === "red")
    oldSelector(expected); // exact former selector: genuine expected failure, never a waiver
  else {
    assertBuiltManifest({
      target,
      manifest: JSON.parse(
        await readFile(join(directory, ".well-known/mdbase-app.json")),
      ),
    });
    const trustAssets = await assertBuiltTrust({
      directory,
      assets: expected,
      sdkTrust,
    });
    const checks = selectServedChecks(expected);
    const offline = parseEmbeddedOfflineShell(
      await readFile(join(directory, "service-worker.js")),
    );
    assert.equal(offline.assets.length, 58);
    const report = {
      kind: "retained-b98-output-POST-CHECK-NOT-new-build-GHA-artifact-dispatch-or-admission",
      originalBuildSource: inputs.source,
      originalBuildTree: inputs.tree,
      files: expected.length,
      servedFiles: checks.length,
      offlineCache: {
        version: offline.version,
        listedFiles: offline.assets.length,
      },
      nativeOriginals: sdkTrust.sdk.native,
      offlineRuntimeOriginal: sdkTrust.sdk.offlineShell,
      servedChecks: checks.map(({ path, urlPath }) => ({ path, urlPath })),
      assets: expected,
      trustAssets,
    };
    await mkdir(join(root, "test-results"), { recursive: true });
    await writeFile(
      join(root, "test-results/native-retained-staging-postcheck.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        phase: "GREEN",
        cacheListedFiles: offline.assets.length,
        nativeOriginals: sdkTrust.sdk.native,
        offlineRuntimeOriginal: sdkTrust.sdk.offlineShell,
        files: expected.length,
        servedFiles: checks.length,
        trustAssets,
      }),
    );
  }
} finally {
  await assertInventory(directory, expected);
  assert.equal((await inventoryDirectory(directory)).length, 69);
  console.log(
    JSON.stringify({
      phase: "AFTER",
      all69FilesUnchanged: true,
      inventoryEvidenceSha256: hash(raw),
    }),
  );
}

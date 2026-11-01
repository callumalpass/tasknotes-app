import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assertPackagedSdk,
  assertProductionTrustPin,
  assertSdkDependency,
  checkProductionSdk,
} from "./production-sdk.mjs";
const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const pin = JSON.parse(read("vendor/production-trust.pin.json"));
const sdk = JSON.parse(read(`vendor/${pin.sdkPin}`));
const stageArchive = fileURLToPath(
  new URL("vendor/sdk-dev-eaa4e697-staging.tgz", root),
);
const member = (name) =>
  execFileSync("tar", ["-xOf", stageArchive, `package/dist/${name}`], {
    maxBuffer: 8_000_000,
  });
const stage = {
  packagedTrust: member("application/packaged-trust.js").toString(),
  provenance: member("native/provenance.json").toString(),
  assetPins: JSON.parse(member("application/asset-pins.json")),
  runtime: member("native/runtime.wasm"),
  sqlite: member("native/sqlite3.wasm"),
  sqliteInitializer: member("native/sqlite3.js"),
};
test("production input matches the beta141 trust asset and the beta149 published SDK", async () => {
  assert.equal(
    pin.trustAssetSha256,
    "7912e40838213e60b65848350d319a48019021317b112e3326429b250f0133d7",
  );
  assert.equal(
    createHash("sha256")
      .update(read("vendor/production-trust.json"))
      .digest("hex"),
    pin.trustAssetSha256,
  );
  assert.equal(
    sdk.sha256,
    "e573c3c2df74076a868e8422ec4e6cf233ede3007806757a03000aed865dedb6",
  );
  assert.equal(sdk.sourceCommit, "4443fd15c4a591e46538eae24cf8425708e6a7f0");
  assertSdkDependency(
    pin,
    sdk,
    JSON.parse(read("package.json")),
    read(`vendor/${sdk.artifact}`),
  );
  const metadata = await checkProductionSdk();
  assert.equal(metadata.environment, "production");
  assert.equal(metadata.assetSha256, pin.trustAssetSha256);
});
test("missing pins, wrong environments and malformed origins fail closed", () => {
  for (const [field, value] of [
    ["schema", "bad"],
    ["environment", "staging"],
    ["cpOrigin", "https://connect-staging.mdbase.dev"],
    ["trustAssetSha256", null],
    ["trustAssetSha256", "A".repeat(64)],
    ["logOrigin", null],
    ["logOrigin", "http://log.example.test"],
    ["logOrigin", "https://log.example.test/path"],
    ["sdkPin", null],
    ["sdkPin", "../escape.json"],
  ])
    assert.throws(() => assertProductionTrustPin({ ...pin, [field]: value }));
});
test("real staging bytes cannot satisfy production, nor source-only SDK output", () => {
  assert.throws(() => assertPackagedSdk(pin, stage), /release environment/);
  assert.throws(
    () =>
      assertPackagedSdk(pin, {
        ...stage,
        packagedTrust: 'throw Error("application_release_trust_unavailable")',
      }),
    /source-only/,
  );
});
test("trust, provenance and every original native asset are checked", () => {
  const productionArchive = fileURLToPath(
    new URL(`vendor/${sdk.artifact}`, root),
  );
  const production = (name) =>
    execFileSync("tar", ["-xOf", productionArchive, `package/dist/${name}`], {
      maxBuffer: 8_000_000,
    });
  const files = {
    packagedTrust: production("application/packaged-trust.js").toString(),
    provenance: production("native/provenance.json").toString(),
    assetPins: JSON.parse(production("application/asset-pins.json")),
    runtime: production("native/runtime.wasm"),
    sqlite: production("native/sqlite3.wasm"),
    sqliteInitializer: production("native/sqlite3.js"),
  };
  const metadata = JSON.parse(
    /^const metadata = (\{.*\});$/m.exec(files.packagedTrust)[1],
  );
  const provenance = JSON.parse(files.provenance);
  assertPackagedSdk(pin, files);
  for (const [field, value] of [
    ["runtime", files.runtime.subarray(1)],
    ["sqlite", undefined],
    ["sqliteInitializer", Buffer.from("bad")],
    ["provenance", undefined],
    ["provenance", stage.provenance],
    ["packagedTrust", "export const metadata = {};"],
  ])
    assert.throws(() => assertPackagedSdk(pin, { ...files, [field]: value }));
  for (const field of ["assetSha256", "logOrigin", "cpOrigin"])
    assert.throws(() =>
      assertPackagedSdk(pin, {
        ...files,
        packagedTrust: `const metadata = ${JSON.stringify({ ...metadata, [field]: "wrong" })};`,
      }),
    );
  for (const field of ["schema", "environment"])
    assert.throws(() =>
      assertPackagedSdk(pin, {
        ...files,
        provenance: JSON.stringify({ ...provenance, [field]: "wrong" }),
      }),
    );
  for (const field of ["sha256", "package", "cpOrigin", "logOrigin"])
    assert.throws(() =>
      assertPackagedSdk(pin, {
        ...files,
        provenance: JSON.stringify({
          ...provenance,
          trust: { ...provenance.trust, [field]: "wrong" },
        }),
      }),
    );
});
test("dependency or archive substitution fails", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.throws(() => assertSdkDependency(pin, sdk, pkg, Buffer.from("bad")));
  assert.throws(() =>
    assertSdkDependency(
      pin,
      sdk,
      { dependencies: { "@mdbase-dev/sdk": "file:vendor/other.tgz" } },
      read(`vendor/${sdk.artifact}`),
    ),
  );
  assert.throws(() =>
    assertSdkDependency(pin, undefined, pkg, read(`vendor/${sdk.artifact}`)),
  );
});

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
  PRODUCTION_SDK_REQUIRED,
} from "./production-sdk.mjs";

const root = new URL("../", import.meta.url);
const refused = (reason) => ({
  message: new RegExp(
    `^${PRODUCTION_SDK_REQUIRED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\nReason: .*${reason}`,
  ),
});

// Real generated files from the LAB-packaged SDK archive kept in vendor/.
const labArchive = fileURLToPath(new URL("vendor/sdk-dev-4fb345e4.tgz", root));
const member = (name) =>
  execFileSync("tar", ["-xOf", labArchive, `package/dist/${name}`], {
    maxBuffer: 8_000_000,
  });
const lab = {
  packagedTrust: member("application/packaged-trust.js").toString("utf8"),
  provenance: member("native/provenance.lab.json").toString("utf8"),
  assetPins: JSON.parse(member("application/asset-pins.json")),
  runtime: member("native/runtime-lab.wasm"),
  sqlite: member("native/sqlite3.wasm"),
  sqliteInitializer: member("native/sqlite3.js"),
};
const labMetadata = JSON.parse(
  /^const metadata = (\{.*\});$/m.exec(lab.packagedTrust)[1],
);

// Synthetic values for tests only. They are not a trust asset or a key.
const pin = {
  schema: "tasknotes/production-trust-pin/1",
  environment: "production",
  cpOrigin: "https://connect.mdbase.dev",
  logOrigin: "https://log.example.test",
  trustAssetSha256: "a".repeat(64),
  sdkPin: "sdk-production-test.json",
};
function productionLike(overrides = {}) {
  const metadata = {
    ...labMetadata,
    environment: "production",
    cpOrigin: pin.cpOrigin,
    logOrigin: pin.logOrigin,
    assetSha256: pin.trustAssetSha256,
    ...overrides.metadata,
  };
  const provenance = JSON.parse(lab.provenance);
  provenance.environment = "production";
  provenance.trust = {
    ...provenance.trust,
    environment: "production",
    cpOrigin: pin.cpOrigin,
    logOrigin: pin.logOrigin,
    sha256: pin.trustAssetSha256,
    ...overrides.trust,
  };
  return {
    ...lab,
    packagedTrust: lab.packagedTrust.replace(
      /^const metadata = \{.*\};$/m,
      `const metadata = ${JSON.stringify(metadata)};`,
    ),
    provenance: JSON.stringify(provenance),
    ...overrides.files,
  };
}

test("the committed production trust pin is absent, so production refuses", () => {
  const committed = JSON.parse(
    readFileSync(new URL("vendor/production-trust.pin.json", root), "utf8"),
  );
  assert.equal(committed.trustAssetSha256, null);
  assert.throws(
    () => assertProductionTrustPin(committed),
    refused("trustAssetSha256 is not set"),
  );
});

test("the trust pin needs every field, with no LAB or staging control plane", () => {
  assert.equal(assertProductionTrustPin(pin), pin);
  for (const [field, value, reason] of [
    ["schema", "other", "wrong schema"],
    ["environment", "lab", "must name production"],
    ["cpOrigin", "https://connect-lab.mdbase.dev", "must name production"],
    ["trustAssetSha256", "A".repeat(64), "trustAssetSha256 is not set"],
    ["logOrigin", null, "logOrigin is not set"],
    ["logOrigin", "http://log.example.test", "exact HTTPS origin"],
    ["logOrigin", "https://log.example.test/path", "exact HTTPS origin"],
    ["sdkPin", null, "sdkPin is not set"],
    ["sdkPin", "../escape.json", "sdkPin is not set"],
  ])
    assert.throws(
      () => assertProductionTrustPin({ ...pin, [field]: value }),
      refused(reason),
    );
});

test("the current build refuses with an actionable reason", async () => {
  await assert.rejects(checkProductionSdk(), refused("trustAssetSha256"));
});

test("a source-only SDK has no release trust and refuses", () => {
  const source = execFileSync("tar", [
    "-xOf",
    fileURLToPath(new URL("vendor/sdk-dev-66b24935.tgz", root)),
    "package/dist/application/packaged-trust.js",
  ]).toString("utf8");
  assert.throws(
    () => assertPackagedSdk(pin, { ...lab, packagedTrust: source }),
    refused("source-only build"),
  );
});

test("a real LAB-packaged SDK never satisfies production", () => {
  assert.throws(
    () => assertPackagedSdk(pin, lab),
    refused("release environment"),
  );
});

test("accepts only an SDK whose embedded release matches every pinned value", () => {
  assert.equal(
    assertPackagedSdk(pin, productionLike()).assetSha256,
    pin.trustAssetSha256,
  );
  for (const [overrides, reason] of [
    [{ metadata: { assetSha256: "b".repeat(64) } }, "release trust digest"],
    [
      { metadata: { logOrigin: "https://other.example.test" } },
      "release log origin",
    ],
    [
      { metadata: { cpOrigin: "https://connect-lab.mdbase.dev" } },
      "release control plane",
    ],
    [{ trust: { sha256: "b".repeat(64) } }, "provenance trust digest"],
    [{ trust: { environment: "lab" } }, "provenance trust environment"],
    [{ files: { provenance: undefined } }, "no packaged native provenance"],
    [{ files: { runtime: lab.runtime.subarray(1) } }, "runtime.wasm"],
    [{ files: { sqlite: undefined } }, "sqlite3.wasm"],
    [{ files: { sqliteInitializer: Buffer.from("x") } }, "sqlite3.js"],
    [
      { files: { packagedTrust: "export const metadata = {};" } },
      "canonical generated form",
    ],
  ])
    assert.throws(
      () => assertPackagedSdk(pin, productionLike(overrides)),
      refused(reason),
    );
});

test("the app must depend on exactly the archive the SDK pin names", () => {
  const archive = Buffer.from("archive");
  const sdkPin = {
    artifact: "sdk-production.tgz",
    sha256: createHash("sha256").update(archive).digest("hex"),
  };
  const pkg = {
    dependencies: { "@mdbase-dev/sdk": "file:vendor/sdk-production.tgz" },
  };
  assertSdkDependency(pin, sdkPin, pkg, archive);
  assert.throws(
    () => assertSdkDependency(pin, sdkPin, pkg, Buffer.from("changed")),
    refused("does not match its pin"),
  );
  assert.throws(
    () =>
      assertSdkDependency(
        pin,
        sdkPin,
        { dependencies: { "@mdbase-dev/sdk": "file:vendor/other.tgz" } },
        archive,
      ),
    refused("does not depend on the pinned SDK archive"),
  );
  assert.throws(
    () => assertSdkDependency(pin, undefined, pkg, archive),
    refused("not a valid SDK pin"),
  );
});

test("only pull-request CI may build the unreleasable candidate", () => {
  const workflow = (name) =>
    readFileSync(new URL(`.github/workflows/${name}`, root), "utf8");
  for (const name of [
    "ios-release.yml",
    "app-store-submit.yml",
    "deploy-pages.yml",
    "google-play-closed-testing.yml",
  ])
    assert.doesNotMatch(workflow(name), /candidate/, name);
  assert.match(workflow("ios-release.yml"), /^\s+pnpm verify$/m);
  for (const name of ["ios.yml", "android.yml"])
    assert.match(
      workflow(name),
      /run: pnpm \$\{\{ github\.event_name == 'pull_request' && 'verify:candidate' \|\| 'verify' \}\}/,
      name,
    );
  const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.equal(pkg.scripts.build, "node scripts/build-production.mjs");
  assert.equal(pkg.scripts.verify, "pnpm verify:checks && pnpm build");
  assert.equal(pkg.scripts["cap:sync"], "pnpm build && cap sync");
});

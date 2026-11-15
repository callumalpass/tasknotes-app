import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import { parse } from "yaml";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url));
const json = (path: string) => JSON.parse(read(path).toString("utf8"));
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const sdk = "node_modules/@mdbase-dev/sdk/";
const rootRead = (path: string) =>
  readFileSync(new URL(`../../../${path}`, import.meta.url));
const trust = JSON.parse(
  rootRead("vendor/production-trust.pin.json").toString("utf8"),
);
const pin = JSON.parse(rootRead(`vendor/${trust.sdkPin}`).toString("utf8"));

it("binds the shared production SDK original and workspace lock to the published release", () => {
  const archive = rootRead(`vendor/${pin.artifact}`);
  expect(archive.length).toBe(pin.bytes);
  expect(hash(archive)).toBe(pin.sha256);
  const sri = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  expect(sri).toBe(pin.sri);
  expect(sri).toBe(pin.publication.integrity);
  expect(json("package.json").dependencies["@mdbase-dev/sdk"]).toBe("catalog:");
  const lock = parse(rootRead("pnpm-lock.yaml").toString("utf8"));
  expect(lock.importers["apps/import"].dependencies["@mdbase-dev/sdk"]).toEqual(
    { specifier: "catalog:", version: pin.version },
  );
  expect(
    lock.packages[`@mdbase-dev/sdk@${pin.version}`].resolution.integrity,
  ).toBe(sri);
  expect(json(sdk + "package.json").version).toBe(pin.version);
});

it("preserves the published production trust and original native assets", () => {
  expect(pin.environment).toBe("production");
  expect(pin.trust.cpOrigin).toBe("https://connect.mdbase.dev");
  expect(pin.trust.logOrigin).toBe("https://log.mdbase.dev");
  const provenance = json(sdk + "dist/native/provenance.json");
  expect(provenance).toMatchObject({
    schema: "mdbase-sdk/npm-publication/1",
    commit: pin.sourceCommit,
    environment: "production",
    trust: pin.trust,
    runtime: pin.runtime,
  });
  const packagedTrust = read(sdk + "dist/application/packaged-trust.js");
  expect(hash(packagedTrust)).toBe(pin.packagedTrustModuleSha256);
  const metadata = JSON.parse(
    packagedTrust.toString("utf8").match(/^const metadata = (\{.*\});$/m)![1],
  );
  expect(metadata).toMatchObject({
    environment: "production",
    cpOrigin: pin.trust.cpOrigin,
    logOrigin: pin.trust.logOrigin,
    assetSha256: pin.trust.sha256,
  });
  const assets = json(sdk + "dist/application/asset-pins.json");
  expect(assets.runtime).toEqual(pin.runtime);
  for (const [path, expected] of [
    ["dist/native/runtime.wasm", assets.runtime],
    ["dist/native/sqlite3.wasm", assets.sqlite],
    ["dist/native/sqlite3.js", assets.sqlite.initializer],
  ] as const) {
    const bytes = read(sdk + path);
    expect(bytes.length).toBe(expected.bytes);
    expect(hash(bytes)).toBe(expected.sha256);
  }
  for (const bundled of pin.bundledDependencies) {
    const bytes = read(sdk + bundled.member.replace(/^package\//, ""));
    expect(bytes.length).toBe(bundled.bytes);
    expect(hash(bytes)).toBe(bundled.sha256);
  }
});

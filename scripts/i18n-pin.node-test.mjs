import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import { locales, localeNames, negotiateLocale } from "@mdbase-dev/i18n";

const root = new URL("../", import.meta.url);
const pins = {
  i18n: {
    bytes: 23479,
    sha256: "4b08df26d7474b26bd90492a1835716f938488b06a73cd3b55943414bc0cbd82",
  },
  ui: {
    bytes: 131844,
    sha256: "1230707f2ba9545a041f2a9325ab5e2d25ed001885ebc0369d836e00b19d30f0",
  },
};

for (const [name, expected] of Object.entries(pins)) {
  test(`Italian ${name} pin retains approved bytes, metadata and frozen lock integrity`, async () => {
    const artifact = `mdbase-dev-${name}-0.1.0-beta.141-49bea0aa.tgz`;
    const manifest = JSON.parse(
      await readFile(
        new URL(`vendor/${artifact.replace(".tgz", ".json")}`, root),
        "utf8",
      ),
    );
    const archive = await readFile(new URL(`vendor/${artifact}`, root));
    assert.equal(archive.length, expected.bytes);
    assert.equal(
      createHash("sha256").update(archive).digest("hex"),
      expected.sha256,
    );
    assert.equal(
      manifest.sourceCommit,
      "49bea0aa3e105fb5f271ef608850504e77a09c52",
    );
    assert.equal(manifest.artifact, artifact);
    assert.equal(manifest.bytes, expected.bytes);
    assert.equal(manifest.sha256, expected.sha256);
    assert.equal(
      manifest.integrity,
      `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    );
    assert.equal(manifest.noPublication, true);
    const pkg = JSON.parse(
      await readFile(new URL("package.json", root), "utf8"),
    );
    const lock = parse(await readFile(new URL("pnpm-lock.yaml", root), "utf8"));
    const dependency = `file:vendor/${artifact}`;
    assert.equal(pkg.dependencies[`@mdbase-dev/${name}`], dependency);
    assert.equal(
      lock.importers["."].dependencies[`@mdbase-dev/${name}`].specifier,
      dependency,
    );
    assert.equal(
      lock.packages[`@mdbase-dev/${name}@${dependency}`].resolution.integrity,
      manifest.integrity,
    );
  });
}

test("the shared kit enables ten locales, Italian negotiation and its endonym", () => {
  assert.deepEqual(locales, [
    "en",
    "fr",
    "de",
    "es",
    "ja",
    "ko",
    "pt",
    "ru",
    "zh",
    "it",
  ]);
  assert.equal(localeNames.it, "Italiano");
  assert.equal(negotiateLocale(["it-IT", "en-US"]), "it");
  assert.equal(negotiateLocale(["unsupported", "it-CH"]), "it");
});

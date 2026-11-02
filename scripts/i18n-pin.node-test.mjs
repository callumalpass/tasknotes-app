import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import { locales, localeNames, negotiateLocale } from "@mdbase-dev/i18n";

const root = new URL("../", import.meta.url);
const version = "0.1.0-beta.149";
const integrity = {
  i18n: "sha512-3Wd2BnU41dhHmAgmw+pqQhQOZg+R/A/HTLGQpknLjRlJu6LlBxJt4Q1DYzbOpFm35/l5dwUpqLemhA6VhLY4PA==",
  ui: "sha512-d1doJT1/+GLwSjYAFz0yagBki5ixXI8VfnCd0Qe9Uevq/d8DwvSMULTg22pGow/jZ1EjmALPToNvytb9sP/9rQ==",
};

for (const [name, expected] of Object.entries(integrity)) {
  test(`shared ${name} uses the exact published npm version and integrity`, async () => {
    const dependency = `@mdbase-dev/${name}`;
    const pkg = JSON.parse(
      await readFile(new URL("package.json", root), "utf8"),
    );
    const lock = parse(await readFile(new URL("pnpm-lock.yaml", root), "utf8"));
    const installed = JSON.parse(
      await readFile(
        new URL(`node_modules/${dependency}/package.json`, root),
        "utf8",
      ),
    );
    assert.equal(pkg.dependencies[dependency], version);
    assert.equal(
      lock.importers["."].dependencies[dependency].specifier,
      version,
    );
    const resolution = lock.packages[`${dependency}@${version}`].resolution;
    assert.equal(resolution.integrity, expected);
    assert.equal(resolution.tarball, undefined);
    assert.equal(installed.version, version);
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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import { locales, localeNames, negotiateLocale } from "@mdbase-dev/i18n";

const root = new URL("../", import.meta.url);
const dependencies = ["@mdbase-dev/i18n", "@mdbase-dev/ui"];
// An exact published version: plain semver or a prerelease, never a range,
// dist-tag, file, link or tarball specifier. The release automation moves the
// pin, so this checks its shape rather than naming one release.
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const registryIntegrity = /^sha512-[A-Za-z0-9+/]{86}==$/;

async function readPins() {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const lock = parse(await readFile(new URL("pnpm-lock.yaml", root), "utf8"));
  return { pkg, lock };
}

for (const dependency of dependencies) {
  test(`${dependency} uses an exact published npm version with registry integrity`, async () => {
    const { pkg, lock } = await readPins();
    const installed = JSON.parse(
      await readFile(
        new URL(`node_modules/${dependency}/package.json`, root),
        "utf8",
      ),
    );
    const version = pkg.dependencies[dependency];
    assert.match(version, exactVersion);
    assert.equal(
      lock.importers["."].dependencies[dependency].specifier,
      version,
    );
    const resolution = lock.packages[`${dependency}@${version}`].resolution;
    assert.match(resolution.integrity, registryIntegrity);
    assert.equal(resolution.tarball, undefined);
    assert.equal(installed.version, version);
  });
}

// Both come from one release line, but i18n is published only when it
// changes, so its newest release can be older than ui's, never newer.
test("shared i18n is pinned no later than ui on the same release line", async () => {
  const { pkg } = await readPins();
  const [i18n, ui] = dependencies.map((name) =>
    pkg.dependencies[name].split(/[.-]/, 3).map(Number),
  );
  assert.deepEqual(i18n.slice(0, 2), ui.slice(0, 2));
  assert.ok(i18n[2] <= ui[2], "i18n must not be newer than ui");
});

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

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);
const legacy = [
  "@mdbase-dev/connect",
  "@mdbase-dev/connect-dev",
  "@mdbase-dev/connect-testing",
  "@mdbase-dev/connect-sync",
];

test("the installed application and test graph has no legacy Connect client packages", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const lock = parse(await readFile(new URL("pnpm-lock.yaml", root), "utf8"));
  for (const name of legacy) {
    assert.equal(pkg.dependencies?.[name], undefined);
    assert.equal(pkg.devDependencies?.[name], undefined);
    assert.equal(pkg.pnpm?.overrides?.[name], undefined);
    assert.equal(
      Object.keys(lock.packages).some((key) => key.startsWith(name + "@")),
      false,
      name,
    );
  }
});

async function sources(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(
      entry.name + (entry.isDirectory() ? "/" : ""),
      directory,
    );
    if (entry.isDirectory()) files.push(...(await sources(url)));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(url);
  }
  return files;
}

test("app, fixtures and benchmarks import the SDK, never the deleted client", async () => {
  for (const directory of ["src/", "benchmarks/"])
    for (const file of await sources(new URL(directory, root))) {
      const source = await readFile(file, "utf8");
      assert.doesNotMatch(
        source,
        /["']@mdbase-dev\/(?:connect(?:\/(?:advanced|testing))?|connect-dev|connect-testing|connect-sync)["']/,
        file.pathname,
      );
    }
});

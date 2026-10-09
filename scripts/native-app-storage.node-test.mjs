import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const digest = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);

test("native app storage has immutable source/archive and SQLite pins", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("vendor/native-app-storage.json", root), "utf8"),
  );
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(
    manifest.sourceCommit,
    "07ae574c815a1c1323d3edd301056345f33349ea",
  );
  assert.equal(
    manifest.consumerEntry,
    "@mdbase-dev/obsidian-runtime/app-storage",
  );
  assert.equal(
    manifest.sha256,
    "991106d71348f7266895d99c8049f5b609b1a9137f44c8992140af59964e7d7f",
  );
  assert.equal(
    pkg.dependencies[manifest.package],
    `file:vendor/${manifest.artifact}`,
  );
  const archive = await readFile(new URL(`vendor/${manifest.artifact}`, root));
  assert.equal(digest(archive), manifest.sha256);
  assert.equal(
    `sha512-${digest(archive, "sha512", "base64")}`,
    manifest.integrity,
  );
  assert.equal(pkg.dependencies[manifest.sqlite.package], "3.53.4-build2");
  assert.equal(manifest.sqlite.version, "3.53.4-build2");
  assert.equal(
    manifest.sqlite.wasmSha256,
    "2ee8f3dab694532afc8840e07703127287662d08b74e6ff50491ce63f00d5752",
  );
  const wasm = await readFile(
    new URL(
      `../${manifest.sqlite.wasm}`,
      import.meta.resolve(manifest.sqlite.package),
    ),
  );
  assert.equal(digest(wasm), manifest.sqlite.wasmSha256);
});

test("public app-storage entry loads without vault/editor or SQLite initialization", async () => {
  const storage = await import("@mdbase-dev/obsidian-runtime/app-storage");
  for (const name of [
    "AppSqliteIndex",
    "AppBinaryIndexHost",
    "appSqlHost",
    "openAppSahpoolIndex",
  ])
    assert.equal(typeof storage[name], "function");
  assert.equal(storage.VaultFilePlatform, undefined);
  await assert.rejects(import("@mdbase-dev/obsidian-runtime"), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  });
});

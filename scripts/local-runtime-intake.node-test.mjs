import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
test("own-local intake pins SDK/storage/optimized app bytes without claiming activation", async () => {
  const intake = JSON.parse(
    await readFile(
      new URL("vendor/mdbase-app-local-b3e605ac.json", root),
      "utf8",
    ),
  );
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const lock = await readFile(new URL("pnpm-lock.yaml", root), "utf8");
  assert.equal(
    intake.source.commit,
    "b3e605acb28139fdb5c5d6024be78ff48876e9b3",
  );
  assert.equal(
    intake.activation,
    "dormant: genuine protected cloud-copy producer and native read gates required",
  );
  for (const [name, artifact, file] of [
    ["@mdbase-dev/sdk", intake.sdk, "mdbase-dev-sdk-0.0.0-b3e605ac.tgz"],
    [
      "@mdbase-dev/obsidian-runtime",
      intake.storage,
      "mdbase-dev-obsidian-runtime-0.0.0-b3e605ac.tgz",
    ],
    [null, intake.wasm, "mdbase-app-runtime-b3e605ac.wasm"],
  ]) {
    assert.equal(artifact.file, file);
    const bytes = await readFile(new URL(`vendor/${file}`, root));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      artifact.sha256,
    );
    if (name) {
      assert.equal(pkg.dependencies[name], `file:vendor/${file}`);
      assert.ok(
        lock.includes(
          `integrity: sha512-${createHash("sha512").update(bytes).digest("base64")}`,
        ),
      );
    } else {
      assert.equal(bytes.length, 2600280);
      assert.equal(bytes.length, artifact.bytes);
      assert.deepEqual(artifact.ceilings, {
        raw: 3000000,
        gzip: 1250000,
        brotli: 950000,
      });
      assert.deepEqual(artifact.targets, {
        raw: 1500000,
        gzip: 600000,
        brotli: 450000,
      });
      for (const [size, ceiling] of [
        [artifact.bytes, artifact.ceilings.raw],
        [artifact.gzipBytes, artifact.ceilings.gzip],
        [artifact.brotliBytes, artifact.ceilings.brotli],
      ])
        assert.ok(size <= ceiling);
      assert.equal(artifact.withinCeilings, true);
      assert.equal(artifact.withinTargets, false);
      const module = await WebAssembly.compile(bytes);
      const exports = WebAssembly.Module.exports(module).map(
        (item) => item.name,
      );
      for (const name of [
        "rt_app_open",
        "rt_app_device_open",
        "rt_app_device_adopt",
        "rt_app_log_generation",
        "rt_app_shutdown",
      ])
        assert.ok(exports.includes(name));
    }
  }
  for (const name of [
    "actualCpAuthentication",
    "appliedPolicy",
    "taskAcceptance",
    "saved",
    "platformCustody",
    "physicalDurability",
    "labAccess",
  ])
    assert.equal(intake.qualification[name], false);
  assert.equal(
    intake.storage.entry,
    "@mdbase-dev/obsidian-runtime/app-storage",
  );
  assert.equal(intake.storage.sqliteWasmVersion, "3.53.4-build2");
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
const root = new URL("../", import.meta.url);

test("private-account SDK UI dependency has immutable source and archive pins", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("vendor/mdbase-dev-sdk-account-956c80d9.json", root),
      "utf8",
    ),
  );
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(
    manifest.sourceCommit,
    "57d484a29284749f59e6935371750e5d65fafa59",
  );
  assert.deepEqual(
    manifest.sourceIncludesPrs,
    [659, 657, 660, 670, 672, 675, 679, 753],
  );
  assert.deepEqual(manifest.consumerEntries, [
    "@mdbase-dev/sdk",
    "@mdbase-dev/sdk/account",
    "@mdbase-dev/sdk/app-host",
  ]);
  assert.equal(manifest.version, "0.0.0");
  assert.equal(
    manifest.sha256,
    "133ac93068bf3a98ad4ab3a7c8b61d051c8c14a0435ab396d26cebd5adb83f8a",
  );
  assert.equal(
    pkg.dependencies["@mdbase-dev/sdk"],
    `file:vendor/${manifest.artifact}`,
  );
  const bytes = await readFile(new URL(`vendor/${manifest.artifact}`, root));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    manifest.sha256,
  );
});

test("private-account facade stays on its optional SDK entry", async () => {
  const account = await import("@mdbase-dev/sdk/account");
  const thin = await import("@mdbase-dev/sdk");
  assert.equal(typeof account.PrivateAccount, "function");
  assert.equal(typeof account.passwordStrength, "function");
  assert.equal(thin.PrivateAccount, undefined);
});

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
    "956c80d9bf27f8c87cc8d208a79af27aa73a4bd1",
  );
  assert.equal(manifest.sourcePr, 390);
  assert.equal(manifest.consumerEntry, "@mdbase-dev/sdk/account");
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

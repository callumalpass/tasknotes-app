import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
const root = new URL("../", import.meta.url);

test("private-account SDK UI dependency has immutable source and archive pins", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("vendor/mdbase-dev-sdk-563dc868.json", root),
      "utf8",
    ),
  );
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(
    manifest.sourceCommit,
    "563dc868fd5847abe272bd8cead1b044cd46fbe0",
  );
  assert.deepEqual(manifest.sourceIncludesPrs, [819, 827, 832, 837]);
  assert.deepEqual(manifest.consumerEntries, [
    "@mdbase-dev/sdk",
    "@mdbase-dev/sdk/account",
    "@mdbase-dev/sdk/app-host",
    "@mdbase-dev/sdk/app-storage",
  ]);
  assert.equal(manifest.version, "0.0.0");
  assert.equal(
    manifest.sha256,
    "8892aaff198437ad51d490dca86faad893275d991f6f848f758e457f4e7a1250",
  );
  assert.equal(
    pkg.dependencies["@mdbase-dev/sdk"],
    `file:vendor/${manifest.artifact}`,
  );
  assert.equal(
    manifest.includedCommits.basesReadFifo,
    "63ffdb8bab24045861dbb726d3ce9a31d2179045",
  );
  assert.equal(
    manifest.includedCommits.enrollmentReconciliation,
    manifest.sourceCommit,
  );
  assert.equal(
    manifest.qualification.label,
    "dev intake, not release-qualified",
  );
  assert.equal(
    pkg.dependencies["@mdbase-dev/connect-protocol"],
    `file:vendor/${manifest.protocol.artifact}`,
  );
  assert.equal(pkg.pnpm.overrides["@mdbase-dev/connect-protocol"], undefined);
  const protocolBytes = await readFile(
    new URL(`vendor/${manifest.protocol.artifact}`, root),
  );
  assert.equal(
    createHash("sha256").update(protocolBytes).digest("hex"),
    manifest.protocol.sha256,
  );
  assert.equal(
    manifest.protocol.sha256,
    "2769616d8ba1a9cbb3dd689fa1ca0b1e2b42e5442634635f2cd4a87f5ec9020f",
  );
  const bytes = await readFile(new URL(`vendor/${manifest.artifact}`, root));
  assert.equal(bytes.byteLength, manifest.bytes);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    manifest.sha256,
  );
  assert.equal(
    `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    manifest.integrity,
  );
});

test("SDK environment stays bound to the authenticated LAB build tuple", async () => {
  const { selectAppEnvironment } = await import("@mdbase-dev/sdk/app-host");
  const { appReleaseTrust } =
    await import("../vendor/mdbase-app-lab-trust.mjs");
  const release = appReleaseTrust();
  const input = {
    environment: "lab",
    appOrigin: "http://127.0.0.1:48218",
    release,
  };
  assert.equal(release.environment, "lab");
  const selected = selectAppEnvironment(input);
  assert.equal(selected.environment, "lab");
  assert.equal(selected.cpOrigin, release.cpOrigin);
  assert.equal(selected.logOrigin, release.logOrigin);
  assert.equal(selected.assetSha256, release.assetSha256);
  assert.equal(selected.allowLoopbackHttp, true);
  assert.throws(() =>
    selectAppEnvironment({ ...input, environment: "production" }),
  );
});

test("private-account facade stays on its optional SDK entry", async () => {
  const account = await import("@mdbase-dev/sdk/account");
  const thin = await import("@mdbase-dev/sdk");
  assert.equal(typeof account.PrivateAccount, "function");
  assert.equal(typeof account.passwordStrength, "function");
  assert.equal(thin.PrivateAccount, undefined);
});

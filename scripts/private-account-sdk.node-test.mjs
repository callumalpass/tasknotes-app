import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
const root = new URL("../", import.meta.url);

test("private-account SDK UI dependency has immutable source and archive pins", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("vendor/sdk-dev-8a557ad6.json", root), "utf8"),
  );
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(
    manifest.sourceCommit,
    "8a557ad68290e04146e456df94c4946d6f033ea7",
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
    "773126b8414b0d2b9b4afd3ec5b94b32b1b5fef51707a01e9db0ea324fbcfdae",
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
    "563dc868fd5847abe272bd8cead1b044cd46fbe0",
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

test("packaged native assets are original bytes, not public application readiness", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("vendor/sdk-dev-8a557ad6.json", root), "utf8"),
  );
  const archive = fileURLToPath(new URL(`vendor/${manifest.artifact}`, root));
  const member = (name) =>
    execFileSync("tar", ["-xOf", archive, name], { maxBuffer: 5_000_000 });
  const native = member(manifest.native.member);
  assert.equal(manifest.native.available, true);
  assert.equal(native.byteLength, manifest.native.bytes);
  assert.equal(
    createHash("sha256").update(native).digest("hex"),
    manifest.native.sha256,
  );
  const provenance = JSON.parse(
    member("package/dist/native/provenance.lab.json"),
  );
  assert.equal(provenance.runtime.sha256, manifest.native.sha256);
  assert.equal(provenance.runtime.source.commit, manifest.native.sourceCommit);
  assert.equal(
    createHash("sha256")
      .update(member("package/dist/native/sqlite3.wasm"))
      .digest("hex"),
    manifest.native.sqliteSha256,
  );
  // Public shell only: no Worker, popup, network, storage or native client.
  const { MdbaseConnect } = await import("@mdbase-dev/sdk");
  const entry = new MdbaseConnect({
    id: "5cdfa020-c201-4da8-845a-f2cc9969eade",
    name: "TaskNotes",
    origin: "http://127.0.0.1:48218",
    environment: "lab",
    manifest: { id: "dev.tasknotes.tasknotes" },
  });
  assert.equal(entry.application().getSnapshot().status, "blocked");
  assert.equal(
    entry.application().getSnapshot().problem,
    "application_not_yet_available",
  );
  assert.equal(entry.connection("not-selected"), null);
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

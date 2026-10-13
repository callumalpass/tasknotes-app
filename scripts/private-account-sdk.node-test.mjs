import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
const root = new URL("../", import.meta.url);

test("private-account SDK UI dependency has immutable source and archive pins", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("vendor/sdk-dev-5c7b9592.json", root), "utf8"),
  );
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(
    manifest.sourceCommit,
    "5c7b9592cc59b49f304f6bc63e5bf25c71701376",
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
    "369a7e15298c8fe90a1be817cf6f1cf15f023fa069755fd58c588019d4f0a30e",
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
    "cd1e15236ab7e25c511a4ba13af6a9df23f4b41715161479bba97b0445e1c138",
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
    await readFile(new URL("vendor/sdk-dev-5c7b9592.json", root), "utf8"),
  );
  const archive = fileURLToPath(new URL(`vendor/${manifest.artifact}`, root));
  const member = (name) =>
    execFileSync("tar", ["-xOf", archive, name], { maxBuffer: 5_000_000 });
  const native = member(manifest.native.member);
  assert.equal(manifest.native.available, true);
  assert.equal(
    manifest.native.sourceCommit,
    "965963fc2944fd624f561bd583062ae8c8336a05",
  );
  assert.equal(manifest.native.bytes, 3580229);
  assert.equal(
    manifest.native.sha256,
    "51f4a0c4e20fedd8d8e2f2bb66f540aff7e4050c2901b53fe556c0a0098d5a6d",
  );
  assert.equal(native.byteLength, manifest.native.bytes);
  assert.equal(
    WebAssembly.Module.exports(new WebAssembly.Module(native)).some(
      ({ name, kind }) => name === "rt_app_setup_assess" && kind === "function",
    ),
    true,
  );
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
  // Node has no browser Worker host: its honest shell performs no IO.
  // This is not a claim that the browser entry is still unavailable.
  const { MdbaseConnect } = await import("@mdbase-dev/sdk");
  const entry = new MdbaseConnect({
    id: "5cdfa020-c201-4da8-845a-f2cc9969eade",
    name: "TaskNotes",
    origin: "http://127.0.0.1:48218",
    environment: "lab",
    manifest: JSON.parse(
      await readFile(new URL("src/generated/mdbase-app.json", root), "utf8"),
    ),
  });
  assert.equal(entry.application().getSnapshot().status, "blocked");
  assert.equal(
    entry.application().getSnapshot().problem,
    "application_not_yet_available",
  );
  assert.equal(entry.connection("not-selected"), null);
  assert.equal(entry.application().getSnapshot().selection.state, "none");
  assert.equal(typeof entry.application().approve, "function");
  assert.equal(typeof entry.application().reauthorize, "function");
  assert.equal(typeof entry.application().chooseAnother, "function");
});

test("the unused protocol warning applies only to the exact first DEV cut", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("vendor/sdk-dev-4b955381.json", root), "utf8"),
  );
  assert.equal(manifest.qualification.productionQualified, false);
  assert.deepEqual(
    manifest.vendorWarnings.map(({ authority, source, path, sha256 }) => ({
      authority,
      source,
      path,
      sha256,
    })),
    [
      {
        authority: "co0648",
        source: "4b9553819ddb769ff1487170c05494321d23ab8b",
        path: "vendor/mdbase-dev-connect-protocol-0.1.0-beta.129.tgz",
        sha256:
          "dfc5db0daf6700874aa2c6235b86570f1d4e444740d0925bf1f97551cf43d3bd",
      },
    ],
  );
  const archive = fileURLToPath(new URL(`vendor/${manifest.artifact}`, root));
  const unused = execFileSync(
    "tar",
    ["-xOf", archive, `package/${manifest.vendorWarnings[0].path}`],
    { maxBuffer: 5_000_000 },
  );
  assert.equal(
    createHash("sha256").update(unused).digest("hex"),
    manifest.vendorWarnings[0].sha256,
  );
  const sdkPackage = JSON.parse(
    execFileSync("tar", ["-xOf", archive, "package/package.json"]),
  );
  assert.equal(
    sdkPackage.dependencies["@mdbase-dev/connect-protocol"],
    `file:vendor/${manifest.protocol.artifact}`,
  );
  assert.equal(
    Object.values(sdkPackage.dependencies).includes(
      `file:${manifest.vendorWarnings[0].path}`,
    ),
    false,
  );
});

test("the successor SDK has no unused protocol exception", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("vendor/sdk-dev-5c7b9592.json", root), "utf8"),
  );
  assert.deepEqual(manifest.vendorWarnings, []);
  assert.equal(manifest.qualification.productionQualified, false);
  const archive = fileURLToPath(new URL(`vendor/${manifest.artifact}`, root));
  const members = execFileSync("tar", ["-tf", archive], {
    encoding: "utf8",
  }).split("\n");
  assert.equal(
    members.includes(
      "package/vendor/mdbase-dev-connect-protocol-0.1.0-beta.129.tgz",
    ),
    false,
  );
  assert.equal(
    members.includes(`package/vendor/${manifest.protocol.artifact}`),
    true,
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

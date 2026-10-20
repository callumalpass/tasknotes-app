import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
const root = new URL("../", import.meta.url);

test("private-account SDK UI dependency has immutable source and archive pins", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("vendor/sdk-dev-eaa4e697-lab.json", root), "utf8"),
  );
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(
    manifest.sourceCommit,
    "eaa4e697fc1198f32fc3714f377342a24c56d985",
  );
  assert.deepEqual(
    manifest.sourceIncludesPrs,
    [
      819, 827, 832, 837, 867, 878, 879, 894, 896, 914, 915, 916, 917, 918, 919,
      920, 921, 923, 924, 925, 926, 929, 941, 942, 943, 944,
    ],
  );
  assert.deepEqual(manifest.consumerEntries, [
    "@mdbase-dev/sdk",
    "@mdbase-dev/sdk/account",
    "@mdbase-dev/sdk/app-host",
    "@mdbase-dev/sdk/app-storage",
  ]);
  assert.equal(manifest.version, "0.0.0");
  assert.equal(
    manifest.sha256,
    "ec8249e19d9d27893ac7ae83b99473a7aad550e4ab54a42dd20786dfd42b8a70",
  );
  assert.equal(
    pkg.dependencies["@mdbase-dev/sdk"],
    `file:vendor/${manifest.artifact}`,
  );
  assert.equal(
    manifest.includedCommits.nativeCompatibilityCopy,
    "3be0abaa4126736a794bc0c03bca2bc2263aa945",
  );
  assert.equal(
    manifest.includedCommits.keyWaitReasonLog,
    "4fb345e4ebb99538a8e20a8218b410a14928021a",
  );
  assert.equal(
    manifest.includedCommits.pacedInitialOpen,
    "0e44e1e100c2bba9608c5ac3145d6cdee30fa4e2",
  );
  assert.equal(
    manifest.includedCommits.progressBoundedColdSync,
    "ddff6d815a913c646bc2889e7fb484e94d7aaf0a",
  );
  assert.equal(
    manifest.includedCommits.boundedRecordReads,
    "a350db1ca88fa3572de3a8c97c43020d7039d035",
  );
  assert.equal(
    manifest.includedCommits.nativePinRefresh,
    "0fabaf20553b7f296f771dd52ea0b65d2d04fcbf",
  );
  assert.equal(
    manifest.includedCommits.openingProgress,
    "bd131b16ccc2d69ffa33ddd37b28fff6366fa429",
  );
  assert.equal(
    manifest.includedCommits.unifiedAddAlias,
    "cc492f3f3832c4939eff7fe39b0fabf5ad234b24",
  );
  assert.equal(
    manifest.includedCommits.productANativePin,
    "a3023aee3731dcbf9de19a41918a84cfb3ae7193",
  );
  assert.equal(
    manifest.includedCommits.downloadStreamPreopenCancellation,
    manifest.sourceCommit,
  );
  assert.equal(
    manifest.includedCommits.reviewedProgressBoundedColdSync,
    "c5f3929bfd21fda89df610fb74eb52c7ada2b54b",
  );
  assert.equal(
    manifest.includedCommits.popupFocus,
    "ab9c7d4d8f28af9c7c7d935af8a1068254d10170",
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
    await readFile(new URL("vendor/sdk-dev-eaa4e697-lab.json", root), "utf8"),
  );
  const archive = fileURLToPath(new URL(`vendor/${manifest.artifact}`, root));
  const member = (name) =>
    execFileSync("tar", ["-xOf", archive, name], { maxBuffer: 5_000_000 });
  const native = member(manifest.native.member);
  assert.equal(manifest.native.available, true);
  assert.equal(
    manifest.native.sourceCommit,
    "725d72b2e43b2b744062e055e43feaeb41838399",
  );
  assert.equal(manifest.native.bytes, 3676583);
  assert.equal(
    manifest.native.sha256,
    "6984f87d98e29d9f99c6b07f7728f716d1f7b2e3585a74bcc2046ba259a8afab",
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
  assert.equal(manifest.native.member, "package/dist/native/runtime.wasm");
  const provenanceBytes = member("package/dist/native/provenance.json");
  const provenance = JSON.parse(provenanceBytes);
  assert.equal(
    createHash("sha256").update(provenanceBytes).digest("hex"),
    manifest.trust.provenanceSha256,
  );
  assert.equal(provenance.environment, "lab");
  assert.equal(provenance.trust.sha256, manifest.trust.sha256);
  assert.equal(provenance.handoff.contextSha256, manifest.trust.contextSha256);
  assert.equal(provenance.handoff.receiptSha256, manifest.trust.receiptSha256);
  assert.equal(provenance.verifier.clockOverride, false);
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
    await readFile(new URL("vendor/sdk-dev-eaa4e697-lab.json", root), "utf8"),
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

test("shared UI successor preserves opening and save-warning consumer exports", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("vendor/ui-dev-fe158b59.json", root), "utf8"),
  );
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(
    manifest.sourceCommit,
    "fe158b5921e8d2eb99fd61c284495fa0a7714e28",
  );
  assert.deepEqual(
    manifest.sourceIncludesPrs,
    [888, 889, 892, 893, 895, 899, 902],
  );
  assert.equal(
    pkg.dependencies["@mdbase-dev/ui"],
    `file:vendor/${manifest.artifact}`,
  );
  const bytes = await readFile(new URL(`vendor/${manifest.artifact}`, root));
  assert.equal(bytes.byteLength, 91016);
  assert.equal(manifest.bytes, bytes.byteLength);
  assert.equal(
    manifest.sha256,
    "e3da3c19b49ee90d3d19df2ea4a1a387b158decfccc8000371f93170eb30b723",
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    manifest.sha256,
  );
  assert.equal(
    `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    manifest.integrity,
  );
  const ui = await import("@mdbase-dev/ui/collections");
  for (const name of [
    "CollectionGate",
    "CollectionProblem",
    "CollectionSwitcher",
    "CollectionSaveWarning",
    "useCollectionSaveWarning",
  ]) {
    assert.equal(typeof ui[name], "function", name);
  }
});

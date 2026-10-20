import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  NATIVE_PUBLISH_TARGETS,
  assertBuiltManifest,
  assertBuiltTrust,
  assertCheckout,
  assertShaOnReleaseRef,
  buildAssetInventory,
  createReceipt,
  nativeBuildEnvironment,
  parsePublishRequest,
  parseWranglerDeployment,
  selectServedChecks,
  verifySdkTrust,
  verifyServedAssets,
} from "./native-publisher.mjs";

const SHA = "153494deb68c71d37a3e99f3ef140d874145e2f1";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// --- publish request / release-ref guard -----------------------------------

test("native publisher accepts only a full SHA dispatched from the target release ref", () => {
  const parsed = parsePublishRequest({
    target: "staging",
    sourceSha: SHA,
    dispatchRef: "refs/heads/release/native-staging",
  });
  assert.equal(parsed.target.environment, "staging");
  assert.equal(parsed.target.releaseRef, "release/native-staging");
  assert.equal(
    parsed.target.appOrigin,
    "https://staging.tasknotes-app.pages.dev",
  );
  assert.equal(parsed.target.editorOrigin, "https://editor-staging.mdbase.dev");
  assert.equal(
    parsed.target.connectOrigin,
    "https://connect-staging.mdbase.dev",
  );
  assert.equal(parsed.sourceSha, SHA);

  assert.throws(
    () =>
      parsePublishRequest({
        target: "lab",
        sourceSha: SHA,
        dispatchRef: "refs/heads/release/native-staging",
      }),
    /target/,
  );
  assert.throws(
    () =>
      parsePublishRequest({
        target: "staging",
        sourceSha: "153494d",
        dispatchRef: "refs/heads/release/native-staging",
      }),
    /full.*SHA|40/,
  );
  assert.throws(
    () =>
      parsePublishRequest({
        target: "staging",
        sourceSha: SHA.toUpperCase(),
        dispatchRef: "refs/heads/release/native-staging",
      }),
    /SHA/,
  );
  assert.throws(
    () =>
      parsePublishRequest({
        target: "staging",
        sourceSha: SHA,
        dispatchRef: "refs/heads/main",
      }),
    /release\/native-staging/,
  );
  assert.throws(
    () =>
      parsePublishRequest({
        target: "production",
        sourceSha: SHA,
        dispatchRef: "refs/heads/release/native-staging",
      }),
    /release\/native-production/,
  );
  assert.throws(
    () =>
      parsePublishRequest({
        target: "staging",
        sourceSha: "main",
        dispatchRef: "refs/heads/release/native-staging",
      }),
    /SHA/,
  );
});

test("native publisher targets never name main as a source ref", () => {
  for (const target of Object.values(NATIVE_PUBLISH_TARGETS)) {
    assert.notEqual(target.releaseRef, "main");
    assert.match(target.releaseRef, /^release\/native-(staging|production)$/);
  }
  assert.equal(
    NATIVE_PUBLISH_TARGETS.production.appOrigin,
    "https://app.tasknotes.dev",
  );
  assert.equal(
    NATIVE_PUBLISH_TARGETS.production.connectOrigin,
    "https://connect.mdbase.dev",
  );
  assert.equal(NATIVE_PUBLISH_TARGETS.production.pagesProject, "tasknotes-app");
  assert.equal(NATIVE_PUBLISH_TARGETS.staging.pagesBranch, "staging");
});

test("release-ref ancestry refuses a SHA that is not on the authorized ref", async () => {
  const target = NATIVE_PUBLISH_TARGETS.staging;
  const git = (ancestor) => async (args) => {
    if (args[0] === "rev-parse" && args.includes("--verify")) return `${SHA}\n`;
    if (args[0] === "merge-base") {
      if (ancestor) return "";
      throw new Error("not ancestor");
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  await assertShaOnReleaseRef({ target, sourceSha: SHA, runGit: git(true) });
  await assert.rejects(
    assertShaOnReleaseRef({ target, sourceSha: SHA, runGit: git(false) }),
    /not on|ancestor/,
  );
  await assert.rejects(
    assertShaOnReleaseRef({
      target,
      sourceSha: SHA,
      runGit: async () => {
        throw new Error("unknown object");
      },
    }),
    /commit|verify/,
  );
});

test("stale release head, dirty checkout, wrong dispatch SHA and prototype targets refuse", async () => {
  assert.throws(
    () =>
      parsePublishRequest({
        target: "toString",
        sourceSha: SHA,
        dispatchRef: "refs/heads/release/native-staging",
      }),
    /target/,
  );
  const target = NATIVE_PUBLISH_TARGETS.staging;
  const git = async (args) => {
    if (args[0] === "status") return "?? injected.mjs\n";
    if (args[0] === "merge-base") return "";
    return SHA;
  };
  await assert.rejects(
    assertCheckout({
      target,
      sourceSha: SHA,
      workflowSha: "b".repeat(40),
      git,
    }),
    /dispatch/,
  );
  await assert.rejects(
    assertCheckout({ target, sourceSha: SHA, workflowSha: SHA, git }),
    /clean/,
  );
  await assert.rejects(
    assertShaOnReleaseRef({
      target,
      sourceSha: SHA,
      runGit: async (args) =>
        args.includes(`refs/remotes/origin/${target.releaseRef}`)
          ? "b".repeat(40)
          : SHA,
    }),
    /exact.*head/,
  );
});

// --- SDK trust guard --------------------------------------------------------

function trustFixture(overrides = {}) {
  const sdkBytes = Buffer.from("sdk-archive");
  const uiBytes = Buffer.from("ui-archive");
  const protocolBytes = Buffer.from("protocol-archive");
  const runtime = Buffer.from([0, 97, 115, 109]);
  const sqlite = Buffer.from([0, 97, 115, 109, 1]);
  const trust = {
    environment: "staging",
    cpOrigin: "https://connect-staging.mdbase.dev",
    logOrigin: "https://log-staging.example.test",
    sha256: sha256("trust-original"),
    sourceCommit: "c".repeat(40),
    contextSha256: sha256("context"),
    receiptSha256: sha256("receipt"),
  };
  const module = Buffer.from(
    `const metadata = ${JSON.stringify({ schema: "mdbn-app-trust/release/1", environment: trust.environment, cpOrigin: trust.cpOrigin, logOrigin: trust.logOrigin, assetSha256: trust.sha256, source: { commit: trust.sourceCommit } })};\n`,
  );
  const provenance = {
    schema: "mdbn-sdk/application-assets/1",
    environment: "staging",
    trust,
    handoff: {
      contextSha256: trust.contextSha256,
      receiptSha256: trust.receiptSha256,
      proof_sha256: Object.fromEntries(
        [
          "image-release-bundle.json",
          "image-release-bundle.sigstore.json",
          "release-trust-bundle.json",
          "release-trust-bundle.sigstore.json",
        ].map((name) => [name, sha256(name)]),
      ),
    },
    verifier: { clockOverride: false, sha256: sha256("verifier") },
    runtime: { sha256: sha256(runtime), bytes: runtime.length },
    sqlite: { sha256: sha256(sqlite), bytes: sqlite.length },
  };
  const provenanceBytes = Buffer.from(JSON.stringify(provenance));
  const members = new Map([
    ["package/dist/native/provenance.json", provenanceBytes],
    ["package/dist/application/packaged-trust.js", module],
    ["package/dist/native/runtime.wasm", runtime],
    ["package/dist/native/sqlite3.wasm", sqlite],
  ]);
  const files = new Map([
    ["vendor/sdk-staging-abc.tgz", sdkBytes],
    ["vendor/ui-staging-def.tgz", uiBytes],
    ["vendor/mdbase-dev-connect-protocol-staging.tgz", protocolBytes],
  ]);
  const companions = new Map([
    [
      "vendor/sdk-staging-abc.json",
      {
        package: "@mdbase-dev/sdk",
        artifact: "sdk-staging-abc.tgz",
        bytes: sdkBytes.length,
        sha256: sha256(sdkBytes),
        sourceCommit: "a".repeat(40),
        protocol: {
          artifact: "mdbase-dev-connect-protocol-staging.tgz",
          bytes: protocolBytes.length,
          sha256: sha256(protocolBytes),
        },
        native: { sha256: sha256(runtime), sqliteSha256: sha256(sqlite) },
        trust: {
          ...trust,
          provenanceSha256: sha256(provenanceBytes),
          packagedTrustSha256: sha256(module),
        },
        ...overrides.sdk,
      },
    ],
    [
      "vendor/ui-staging-def.json",
      {
        package: "@mdbase-dev/ui",
        artifact: "ui-staging-def.tgz",
        bytes: uiBytes.length,
        sha256: sha256(uiBytes),
        pairedSdkSource: "a".repeat(40),
        ...overrides.ui,
      },
    ],
  ]);
  return {
    packageJson: {
      dependencies: {
        "@mdbase-dev/sdk": "file:vendor/sdk-staging-abc.tgz",
        "@mdbase-dev/ui": "file:vendor/ui-staging-def.tgz",
        "@mdbase-dev/connect-protocol":
          "file:vendor/mdbase-dev-connect-protocol-staging.tgz",
      },
    },
    readCompanion: async (path) => {
      if (!companions.has(path)) throw new Error(`ENOENT ${path}`);
      return companions.get(path);
    },
    hashFile: async (path) => {
      if (!files.has(path)) throw new Error(`ENOENT ${path}`);
      const bytes = files.get(path);
      return { sha256: sha256(bytes), bytes: bytes.length };
    },
    readMember: async (_archive, member) => {
      if (!members.has(member)) throw new Error(`Missing member ${member}`);
      return members.get(member);
    },
    approvedHashes: {
      sdk: sha256(sdkBytes),
      ui: sha256(uiBytes),
      protocol: sha256(protocolBytes),
    },
    companions,
    files,
    members,
  };
}

test("SDK trust guard accepts an authenticated staging archive set and inventories it", async () => {
  const fixture = trustFixture();
  const inventory = await verifySdkTrust({
    target: NATIVE_PUBLISH_TARGETS.staging,
    ...fixture,
  });
  assert.equal(inventory.sdk.artifact, "vendor/sdk-staging-abc.tgz");
  assert.equal(inventory.sdk.trust.environment, "staging");
  assert.equal(
    inventory.sdk.trust.cpOrigin,
    "https://connect-staging.mdbase.dev",
  );
  assert.equal(
    inventory.sdk.native.sha256,
    sha256(Buffer.from([0, 97, 115, 109])),
  );
  assert.equal(inventory.ui.artifact, "vendor/ui-staging-def.tgz");
  assert.equal(
    inventory.protocol.artifact,
    "vendor/mdbase-dev-connect-protocol-staging.tgz",
  );
});

test("SDK trust guard refuses the LAB archive for staging and production", async () => {
  const lab = trustFixture({
    sdk: {
      trust: {
        environment: "lab",
        cpOrigin: "https://connect-lab.mdbase.dev",
        sha256: "t".padEnd(64, "0"),
      },
    },
  });
  await assert.rejects(
    verifySdkTrust({ target: NATIVE_PUBLISH_TARGETS.staging, ...lab }),
    /trust.*staging|environment/,
  );
  await assert.rejects(
    verifySdkTrust({
      target: NATIVE_PUBLISH_TARGETS.production,
      ...trustFixture(),
    }),
    /trust.*production|environment/,
  );
});

test("SDK trust guard refuses hash, CP, pairing and publication mismatches before upload", async () => {
  const target = NATIVE_PUBLISH_TARGETS.staging;

  const badHash = trustFixture();
  badHash.companions.get("vendor/sdk-staging-abc.json").sha256 = "0".repeat(64);
  await assert.rejects(verifySdkTrust({ target, ...badHash }), /sha256|hash/);

  const badCp = trustFixture();
  badCp.companions.get("vendor/sdk-staging-abc.json").trust.cpOrigin =
    "https://connect-lab.mdbase.dev";
  await assert.rejects(
    verifySdkTrust({ target, ...badCp }),
    /cpOrigin|Connect/,
  );

  const badUiPair = trustFixture();
  badUiPair.companions.get("vendor/ui-staging-def.json").pairedSdkSource =
    "b".repeat(40);
  await assert.rejects(verifySdkTrust({ target, ...badUiPair }), /paired/);

  const noPublication = trustFixture({ ui: { noPublication: true } });
  await assert.rejects(
    verifySdkTrust({ target, ...noPublication }),
    /noPublication|not.*publication/,
  );

  const missingTrust = trustFixture();
  delete missingTrust.companions.get("vendor/sdk-staging-abc.json").trust;
  await assert.rejects(verifySdkTrust({ target, ...missingTrust }), /trust/);

  const missingCompanion = trustFixture();
  missingCompanion.companions.delete("vendor/sdk-staging-abc.json");
  await assert.rejects(
    verifySdkTrust({ target, ...missingCompanion }),
    /companion|ENOENT/,
  );

  const registryPin = trustFixture();
  registryPin.packageJson.dependencies["@mdbase-dev/sdk"] = "0.1.0";
  await assert.rejects(
    verifySdkTrust({ target, ...registryPin }),
    /file:vendor/,
  );
});

test("companion relabel cannot retarget actual packaged LAB trust, and protected hash approvals are mandatory", async () => {
  const target = NATIVE_PUBLISH_TARGETS.staging;
  const missingApproval = trustFixture();
  delete missingApproval.approvedHashes.sdk;
  await assert.rejects(
    verifySdkTrust({ target, ...missingApproval }),
    /protected-environment/,
  );
  const forged = trustFixture();
  forged.approvedHashes.sdk = "b".repeat(64);
  await assert.rejects(
    verifySdkTrust({ target, ...forged }),
    /approved original/,
  );
  for (const member of [
    "package/dist/application/packaged-trust.js",
    "package/dist/native/provenance.json",
    "package/dist/native/runtime.wasm",
    "package/dist/native/sqlite3.wasm",
  ]) {
    const fixture = trustFixture();
    fixture.members.set(
      member,
      Buffer.from(member.endsWith(".json") ? "{}" : "LAB archive bytes"),
    );
    await assert.rejects(verifySdkTrust({ target, ...fixture }), /mismatch/);
  }
  const pathTraversal = trustFixture();
  pathTraversal.packageJson.dependencies["@mdbase-dev/sdk"] =
    "file:vendor/../sdk.tgz";
  await assert.rejects(
    verifySdkTrust({ target, ...pathTraversal }),
    /file:vendor/,
  );
  const noTrustHash = trustFixture();
  delete noTrustHash.companions.get("vendor/sdk-staging-abc.json").trust.sha256;
  await assert.rejects(verifySdkTrust({ target, ...noTrustHash }), /sha256/);
});

// --- build environment ------------------------------------------------------

test("staging build environment carries exact origins and no loopback or LAB origin", () => {
  const environment = nativeBuildEnvironment(
    NATIVE_PUBLISH_TARGETS.staging,
    {},
  );
  assert.equal(environment.VITE_TASKNOTES_ENVIRONMENT, "staging");
  assert.equal(
    environment.TASKNOTES_APP_URL,
    "https://staging.tasknotes-app.pages.dev",
  );
  assert.equal(
    environment.VITE_MDBASE_CONNECT_URL,
    "https://connect-staging.mdbase.dev",
  );
  assert.equal(
    environment.VITE_TASKNOTES_EDITOR_ORIGIN,
    "https://editor-staging.mdbase.dev",
  );
  assert.equal(environment.VITE_TASKNOTES_LAB_ORIGIN, "");
  assert.equal("VITE_MDBASE_CONNECT_LOOPBACK_URL" in environment, false);
  assert.throws(
    () =>
      nativeBuildEnvironment(NATIVE_PUBLISH_TARGETS.staging, {
        VITE_MDBASE_CONNECT_LOOPBACK_URL: "http://127.0.0.1:28487",
      }),
    /LOOPBACK/,
  );
});

test("publisher refuses contradictory environment selectors and test-only entry flags", () => {
  for (const target of Object.values(NATIVE_PUBLISH_TARGETS)) {
    for (const key of ["MDBASE_ENV", "TASKNOTES_DEPLOY_TARGET"]) {
      assert.throws(
        () => nativeBuildEnvironment(target, { [key]: "lab" }),
        /requires/,
      );
    }
    assert.throws(
      () =>
        nativeBuildEnvironment(target, {
          VITE_TASKNOTES_ANDROID_NOTIFICATION_TEST: "1",
        }),
      /test-only/,
    );
  }
});

test("production build uses documented exact origins and refuses LAB or loopback", () => {
  const configured = NATIVE_PUBLISH_TARGETS.production;
  assert.equal(configured.editorOrigin, "https://editor.mdbase.dev");
  const environment = nativeBuildEnvironment(configured, {
    TASKNOTES_FIREBASE_PROJECT_ID: "project-from-vars",
  });
  assert.equal(environment.VITE_TASKNOTES_ENVIRONMENT, "production");
  assert.equal(environment.TASKNOTES_APP_URL, "https://app.tasknotes.dev");
  assert.equal(
    environment.VITE_MDBASE_CONNECT_URL,
    "https://connect.mdbase.dev",
  );
  assert.equal(environment.TASKNOTES_FIREBASE_PROJECT_ID, "project-from-vars");
  assert.equal("VITE_MDBASE_CONNECT_LOOPBACK_URL" in environment, false);
  assert.throws(
    () =>
      nativeBuildEnvironment(configured, {
        VITE_TASKNOTES_LAB_ORIGIN: "https://lab.tasknotes-app.pages.dev",
      }),
    /LAB/,
  );
  assert.throws(
    () =>
      nativeBuildEnvironment(configured, {
        VITE_MDBASE_CONNECT_LOOPBACK_URL: "http://127.0.0.1:28487",
      }),
    /LOOPBACK/,
  );
});

// --- built manifest ---------------------------------------------------------

test("built manifest must declare the exact target origin", () => {
  const target = NATIVE_PUBLISH_TARGETS.staging;
  const manifest = {
    homepage: "https://staging.tasknotes-app.pages.dev/",
    icon: "https://staging.tasknotes-app.pages.dev/icon.png",
    redirect_uris: [
      "https://staging.tasknotes-app.pages.dev/auth/mdbase/callback",
    ],
    installation_origins: {
      staging: { "app-runtime": ["https://staging.tasknotes-app.pages.dev"] },
    },
  };
  assertBuiltManifest({ manifest, target });
  assert.throws(
    () =>
      assertBuiltManifest({
        manifest: { ...manifest, homepage: "https://app.tasknotes.dev/" },
        target,
      }),
    /manifest/,
  );
  assert.throws(
    () =>
      assertBuiltManifest({
        manifest: { ...manifest, installation_origins: {} },
        target,
      }),
    /installation_origins|manifest/,
  );
});

test("built manifest refuses extra target installation origins", () => {
  assert.throws(
    () =>
      assertBuiltManifest({
        target: NATIVE_PUBLISH_TARGETS.staging,
        manifest: {
          homepage: `${NATIVE_PUBLISH_TARGETS.staging.appOrigin}/`,
          icon: `${NATIVE_PUBLISH_TARGETS.staging.appOrigin}/icon.png`,
          redirect_uris: [
            `${NATIVE_PUBLISH_TARGETS.staging.appOrigin}/auth/mdbase/callback`,
          ],
          installation_origins: {
            staging: {
              "app-runtime": [
                NATIVE_PUBLISH_TARGETS.staging.appOrigin,
                "https://evil.example",
              ],
            },
          },
        },
      }),
    /manifest/,
  );
});

// --- asset inventory, receipt, served-byte verification ---------------------

async function distFixture() {
  const directory = await mkdtemp(
    join(tmpdir(), "tasknotes-native-publisher-"),
  );
  const files = {
    "index.html": "<html>TaskNotes</html>",
    ".well-known/mdbase-app.json": "{}",
    "manifest.webmanifest": "{}",
    "service-worker.js": "// worker",
    "assets/app-abc.js": `console.log('${sha256("trust-original")}')`,
    "assets/runtime-def.wasm": Buffer.from([0, 97, 115, 109]),
    "assets/sqlite3-ghi.wasm": Buffer.from([0, 97, 115, 109, 1]),
    "icon.png": Buffer.from([137, 80, 78, 71]),
  };
  for (const [name, bytes] of Object.entries(files)) {
    const path = join(directory, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, bytes);
  }
  return { directory, files };
}

test("asset inventory is sorted, hashed, and the receipt binds source, trust and deployment", async () => {
  const { directory } = await distFixture();
  try {
    const assets = await buildAssetInventory(directory);
    assert.deepEqual(
      assets.map((asset) => asset.path),
      [...assets.map((asset) => asset.path)].sort(),
    );
    assert.equal(
      assets.find((asset) => asset.path === "index.html").sha256,
      sha256("<html>TaskNotes</html>"),
    );
    const receipt = createReceipt({
      target: NATIVE_PUBLISH_TARGETS.staging,
      sourceSha: SHA,
      sourceTree: "t".repeat(40),
      sdkTrust: { sdk: { sha256: "x" } },
      assets,
      deployment: { id: "dep-1", url: "https://abc.tasknotes-app.pages.dev" },
    });
    assert.equal(receipt.source.sha, SHA);
    assert.equal(receipt.source.tree, "t".repeat(40));
    assert.equal(receipt.target.releaseRef, "release/native-staging");
    assert.equal(receipt.target.trustEnvironment, "staging");
    assert.equal(
      receipt.target.connectOrigin,
      "https://connect-staging.mdbase.dev",
    );
    assert.equal(receipt.deployment.id, "dep-1");
    assert.equal(receipt.assets.length, assets.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("served-byte verification compares bytes, not HTTP 200, and requires native assets", async () => {
  const { directory, files } = await distFixture();
  try {
    const assets = await buildAssetInventory(directory);
    const checks = selectServedChecks(assets);
    assert.ok(
      checks.some(
        (check) => check.path === "index.html" && check.urlPath === "/",
      ),
    );
    assert.ok(checks.some((check) => check.path.endsWith(".wasm")));
    assert.ok(
      checks.some((check) => check.urlPath === "/auth/mdbase/callback"),
    );

    const bytesByPath = new Map(
      Object.entries(files).map(([path, bytes]) => [path, Buffer.from(bytes)]),
    );
    const okFetch = async (url) => {
      const check = checks.find((candidate) => url.endsWith(candidate.urlPath));
      return new Response(bytesByPath.get(check.path), { status: 200 });
    };
    const report = await verifyServedAssets({
      origin: "https://staging.tasknotes-app.pages.dev",
      assets,
      fetchImpl: okFetch,
      sleep: async () => {},
    });
    assert.equal(report.verified.length, checks.length);

    const tamperedFetch = async (url) => {
      const check = checks.find((candidate) => url.endsWith(candidate.urlPath));
      const bytes = check.path.endsWith(".wasm")
        ? Buffer.from("tampered")
        : bytesByPath.get(check.path);
      return new Response(bytes, { status: 200 });
    };
    await assert.rejects(
      verifyServedAssets({
        origin: "https://staging.tasknotes-app.pages.dev",
        assets,
        fetchImpl: tamperedFetch,
        sleep: async () => {},
        attempts: 1,
      }),
      /mismatch.*wasm|served.*mismatch/,
    );

    const withoutWasm = assets.filter((asset) => !asset.path.endsWith(".wasm"));
    assert.throws(() => selectServedChecks(withoutWasm), /WASM|wasm/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("served-byte verification retries a propagating deployment then fails bounded", async () => {
  const { directory, files } = await distFixture();
  try {
    const assets = await buildAssetInventory(directory);
    let calls = 0;
    const flaky = async (url) => {
      calls += 1;
      if (calls === 1) return new Response("not yet", { status: 404 });
      const path = url.replace("https://staging.tasknotes-app.pages.dev", "");
      const name = path === "/" ? "index.html" : path.slice(1);
      const bytes = files[name] ?? files["index.html"];
      return new Response(Buffer.from(bytes), { status: 200 });
    };
    const report = await verifyServedAssets({
      origin: "https://staging.tasknotes-app.pages.dev",
      assets,
      fetchImpl: flaky,
      sleep: async () => {},
    });
    assert.ok(report.verified.length > 0);
    assert.ok(calls > report.verified.length);
    calls = 0;
    await assert.rejects(
      verifyServedAssets({
        origin: "https://staging.tasknotes-app.pages.dev",
        assets,
        attempts: 2,
        sleep: async () => {},
        fetchImpl: async () => {
          calls += 1;
          return new Response("denied", { status: 403 });
        },
      }),
      /403/,
    );
    assert.equal(calls, 2); // bounded failure, no credential/auth bypass
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("served verifier covers JS/trust bytes, redirects, missing SQLite and invalid limits", async () => {
  const { directory } = await distFixture();
  try {
    const assets = await buildAssetInventory(directory);
    assert.throws(
      () =>
        selectServedChecks(
          assets.filter((asset) => !asset.path.includes("sqlite")),
        ),
      /SQLite/,
    );
    const checks = selectServedChecks(assets);
    for (const status of [200, 302]) {
      await assert.rejects(
        verifyServedAssets({
          origin: NATIVE_PUBLISH_TARGETS.staging.appOrigin,
          assets,
          attempts: 1,
          fetchImpl: async (_url, options) => {
            assert.equal(options.redirect, "manual");
            assert.equal(options.credentials, "omit");
            assert.ok(options.signal instanceof AbortSignal);
            return new Response("HTTP 200 is not proof", { status });
          },
        }),
        /mismatch/,
      );
    }
    assert.ok(checks.some((check) => check.path.endsWith(".js")));
    await assert.rejects(
      verifyServedAssets({
        origin: "https://preview.tasknotes-app.pages.dev",
        assets,
      }),
      /real target/,
    );
    await assert.rejects(
      verifyServedAssets({
        origin: NATIVE_PUBLISH_TARGETS.staging.appOrigin,
        assets,
        attempts: 0,
      }),
      /bounded/,
    );
    await symlink("index.html", join(directory, "linked.html"));
    await assert.rejects(buildAssetInventory(directory), /symlink/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("build must include original native/SQLite and embedded trust, not just filenames", async () => {
  const { directory } = await distFixture();
  try {
    const sdkTrust = await verifySdkTrust({
      target: NATIVE_PUBLISH_TARGETS.staging,
      ...trustFixture(),
    });
    const assets = await buildAssetInventory(directory);
    assert.deepEqual(await assertBuiltTrust({ directory, assets, sdkTrust }), [
      "assets/app-abc.js",
    ]);
    const wrongSdk = structuredClone(sdkTrust);
    wrongSdk.sdk.native.sha256 = "f".repeat(64);
    await assert.rejects(
      assertBuiltTrust({ directory, assets, sdkTrust: wrongSdk }),
      /WASM/,
    );
    await writeFile(
      join(directory, "assets/app-abc.js"),
      "console.log('no trust')",
    );
    await assert.rejects(
      assertBuiltTrust({
        directory,
        assets: await buildAssetInventory(directory),
        sdkTrust,
      }),
      /trust/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deployment receipt uses actual Pages ID from structured Wrangler output, never URL prefix", () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  const output = JSON.stringify({
    type: "pages-deploy",
    pages_project: "tasknotes-app",
    deployment_id: id,
    url: "https://abcd1234.tasknotes-app.pages.dev",
  });
  assert.equal(parseWranglerDeployment(output).id, id);
  assert.throws(() =>
    parseWranglerDeployment(
      "Deployment complete https://abcd1234.tasknotes-app.pages.dev",
    ),
  );
  assert.throws(
    () =>
      parseWranglerDeployment(output.replace("tasknotes-app", "wrong-project")),
    /ID/,
  );
});

test("workflow isolates native manual route and retains legacy GitHub Pages guards", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/deploy-pages.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /publisher:/);
  assert.match(workflow, /source_sha:/);
  assert.match(workflow, /native-publish:/);
  assert.match(workflow, /name: \$\{\{ inputs.target \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /ref: \$\{\{ inputs.source_sha \}\}/);
  assert.match(workflow, /NATIVE_SDK_SHA256/);
  assert.match(workflow, /native-publisher.mjs guard/);
  assert.match(workflow, /native-publisher.mjs prepare/);
  assert.match(workflow, /native-publisher.mjs publish/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /if: inputs.publisher != 'native'/);
  assert.match(workflow, /Pages deployments only run from main/);
  assert.match(workflow, /callumalpass.github.io\/tasknotes-app/);
});

import assert from "node:assert/strict";
import { originalOfflineRuntime } from "./lib/native-offline-shell.mjs";
import { offlineShellFor } from "./fixtures/offline-shell-data.mjs";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
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
const checksCount = (assets) => selectServedChecks(assets).length;

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

test("actual missing target intake refuses (no LAB/UI relabel fallback)", async () => {
  await assert.rejects(
    verifySdkTrust({
      root: new URL("../", import.meta.url).pathname,
      target: NATIVE_PUBLISH_TARGETS.production,
    }),
    /Missing actual reviewed target intake/,
  );
  const historical = await verifySdkTrust({
    root: new URL("../", import.meta.url).pathname,
    target: NATIVE_PUBLISH_TARGETS.staging,
  });
  assert.deepEqual(historical.publicationConstraints, []);
  assert.equal(historical.historicalUiQualification.noPublication, true);
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
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "tasknotes-native-publisher-")),
  );
  const files = {
    "index.html": "<html>TaskNotes</html>",
    ".well-known/mdbase-app.json": "{}",
    "manifest.webmanifest": "{}",
    "service-worker.js": "// worker",
    "mdbase-shell-runtime.js": "// original shell runtime",
    "auth/mdbase/callback.html": "<html>TaskNotes</html>",
    "assets/sqlite3-init.js": "// sqlite initializer",
    "assets/app-abc.js": `console.log('${sha256("trust-original")}')`,
    "assets/runtime-def.wasm": Buffer.from([0, 97, 115, 109]),
    "assets/sqlite3-ghi.wasm": Buffer.from([0, 97, 115, 109, 1]),
    "icon.png": Buffer.from([137, 80, 78, 71]),
  };
  files["service-worker.js"] = offlineShellFor(files);
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
    assert.equal(calls, checksCount(assets)); // 403 is non-retryable; every file explicitly fails
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
    assert.throws(
      () =>
        selectServedChecks(
          assets.filter((a) => a.path !== "mdbase-shell-runtime.js"),
        ),
      /required served asset mdbase-shell-runtime/,
    );
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
      /invalid-limit/,
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
    const sdkTrust = {
      sdk: {
        trust: { sha256: sha256("trust-original") },
        offlineShell: originalOfflineRuntime(
          Buffer.from("// original shell runtime"),
        ),
        native: {
          sha256: sha256(Buffer.from([0, 97, 115, 109])),
          sqliteSha256: sha256(Buffer.from([0, 97, 115, 109, 1])),
          sqliteInitializerSha256: sha256("// sqlite initializer"),
        },
      },
    };
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
    const wrongTrust = structuredClone(sdkTrust);
    wrongTrust.sdk.trust.sha256 = "e".repeat(64);
    await assert.rejects(
      assertBuiltTrust({ directory, assets, sdkTrust: wrongTrust }),
      /trust/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Pages worker bytes remain inventoried but GET is never execution evidence", () => {
  const assets = [
    "index.html",
    ".well-known/mdbase-app.json",
    "manifest.webmanifest",
    "service-worker.js",
    "mdbase-shell-runtime.js",
    "app.js",
    "runtime.wasm",
    "sqlite3.wasm",
    "_worker.js",
  ].map((path) => ({ path, bytes: 1, sha256: sha256("x") }));
  assert.ok(
    !selectServedChecks(assets).some((item) => item.path === "_worker.js"),
  );
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
  assert.throws(
    () => parseWranglerDeployment(output.replace(id, "-".repeat(36))),
    /ID/,
  );
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
  assert.match(workflow, /native-build:/);
  const build =
    workflow.split("  native-build:")[1]?.split("  native-publish:")[0] ?? "";
  assert.ok(build.length > 0);
  assert.doesNotMatch(
    build,
    /environment:|secrets\.|CLOUDFLARE_|actions: read/,
  );
  const upload = workflow.split("  native-publish:")[1] ?? "";
  assert.doesNotMatch(
    upload,
    /pnpm build|native-publisher.mjs prepare|cache: pnpm/,
  );
  assert.match(upload, /permissions:\s+contents: read\s+actions: read/);
  assert.match(upload, /id: native_upload/);
  assert.match(
    upload,
    /if: steps.native_upload.outcome == 'success' && steps.native_upload.outputs.deployment_id != ''/,
  );
  assert.match(
    upload,
    /NATIVE_DEPLOYMENT_ID: \$\{\{ steps.native_upload.outputs.deployment_id \}\}/,
  );
  assert.match(upload, /native-publisher-upload.mjs verify/);
  const verifyStep = upload
    .split("- name: Verify actual served bytes")[1]
    ?.split("- name: Retain failed receipt")[0];
  assert.ok(verifyStep);
  assert.doesNotMatch(verifyStep, /CLOUDFLARE_|GITHUB_TOKEN|secrets\./);
  assert.match(upload, /NATIVE_TRUST_ASSET_SHA256/);
  assert.match(workflow, /include-hidden-files: true/);
  assert.match(workflow, /native-publish:/);
  assert.match(workflow, /name: \$\{\{ inputs.target \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /ref: \$\{\{ inputs.source_sha \}\}/);
  assert.match(workflow, /NATIVE_SDK_SHA256/);
  assert.match(workflow, /native-publisher.mjs guard/);
  assert.match(workflow, /native-publisher.mjs prepare/);
  assert.match(workflow, /native-publisher-upload.mjs/);
  assert.match(upload, /--ignore-scripts --ignore-workspace/);
  assert.match(upload, /scripts\/native-publish-tooling\/pnpm-lock.yaml/);
  assert.match(upload, /env -i PATH=/);
  assert.match(upload, /run_install: false/);
  assert.match(
    upload,
    /cd "\$tool"[\s\S]*env -i[\s\S]*pnpm install --frozen-lockfile --ignore-scripts --ignore-workspace/,
  );
  assert.equal((upload.match(/pnpm install/g) ?? []).length, 1); // dedicated TOOL closure only, per Co05:15:43
  assert.ok(
    build.indexOf("guard-installed") < build.indexOf("pnpm test:release"),
  );
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /if: inputs.publisher != 'native'/);
  assert.match(workflow, /Pages deployments only run from main/);
  assert.match(workflow, /callumalpass.github.io\/tasknotes-app/);
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { verifyTargetIntake } from "./lib/native-publish-intake.mjs";
import { frozenStagingRoot } from "./fixtures/staging-intake-root.mjs";
import { test } from "node:test";
import {
  validateArtifactMetadata,
  validatePreparedReceipt,
  assertCurrentReleaseHead,
  assertCapturedDeployment,
  upload,
} from "./native-publisher-upload.mjs";
import { NATIVE_PUBLISH_TARGETS, createReceipt } from "./native-publisher.mjs";
import { verifyServedAssets } from "./verify-native-served.mjs";
import {
  assertTrustedHeaders,
  verifyTrustedHostingPolicy,
} from "./lib/native-publish-hosting.mjs";
const exec = promisify(execFile);
const sha = "a".repeat(40),
  tree = "b".repeat(40),
  digest = "c".repeat(64);
const target = NATIVE_PUBLISH_TARGETS.staging;
function metadataFixture() {
  return {
    id: "42",
    digest,
    repository: "mdbase-dev/tasknotes-app",
    runId: "11",
    attempt: "2",
    sourceSha: sha,
    target: "staging",
    metadata: {
      id: 42,
      digest: `sha256:${digest}`,
      expired: false,
      name: `tasknotes-native-build-staging-${sha}-11-2`,
      workflow_run: {
        id: 11,
        head_sha: sha,
        repository_id: 7,
        head_repository_id: 7,
        head_branch: target.releaseRef,
      },
    },
    run: {
      id: 11,
      run_attempt: 2,
      head_sha: sha,
      event: "workflow_dispatch",
      head_branch: target.releaseRef,
      repository: { id: 7, full_name: "mdbase-dev/tasknotes-app" },
    },
  };
}
test("immutable artifact identity/digest/repository/run/attempt/source/target bound, no latest/name lookup", () => {
  validateArtifactMetadata(metadataFixture());
});
for (const [object, key, value] of [
  ["metadata", "id", 43],
  ["metadata", "digest", "sha256:" + "d".repeat(64)],
  ["metadata", "expired", true],
  ["metadata", "name", "latest"],
  ["workflow_run", "id", 12],
  ["workflow_run", "head_sha", "d".repeat(40)],
  ["workflow_run", "repository_id", 8],
  ["workflow_run", "head_repository_id", 8],
  ["workflow_run", "head_branch", "main"],
  ["run", "run_attempt", 1],
  ["run", "head_sha", "d".repeat(40)],
  ["run", "event", "pull_request"],
  ["run", "head_branch", "release/native-production"],
  ["repository", "full_name", "attacker/repo"],
])
  test(`artifact mismatched ${object}.${key} refuses`, () => {
    const f = metadataFixture();
    const at =
      object === "workflow_run"
        ? f.metadata.workflow_run
        : object === "repository"
          ? f.run.repository
          : f[object];
    at[key] = value;
    assert.throws(() => validateArtifactMetadata(f), /mismatch/);
  });
test("remote native HEAD (not stale origin ref/ancestry) is rechecked with exact literal ref", async () => {
  const calls = [];
  await assertCurrentReleaseHead({
    target,
    sourceSha: sha,
    git: async (args) => {
      calls.push(args);
      return `${sha}\trefs/heads/${target.releaseRef}\n`;
    },
  });
  assert.deepEqual(calls, [
    ["ls-remote", "--exit-code", "origin", "refs/heads/release/native-staging"],
  ]);
  for (const output of [
    `${"d".repeat(40)}\trefs/heads/${target.releaseRef}`,
    `${sha}\trefs/heads/main`,
    `${sha}\trefs/heads/${target.releaseRef}\n${sha}\trefs/heads/main`,
    "",
  ])
    await assert.rejects(
      assertCurrentReleaseHead({
        target,
        sourceSha: sha,
        git: async () => output,
      }),
      /current native HEAD/,
    );
});
test("artifact receipt binds exact source/tree/target/run/full original inventory and required native bytes", () => {
  const environment = {
    GITHUB_REPOSITORY: "mdbase-dev/tasknotes-app",
    GITHUB_RUN_ID: "11",
    GITHUB_RUN_ATTEMPT: "2",
  };
  const sdkTrust = {
    sdk: {
      native: {
        sha256: "d".repeat(64),
        sqliteSha256: "e".repeat(64),
        sqliteInitializerSha256: "f".repeat(64),
      },
    },
  };
  const paths = [
    "index.html",
    ".well-known/mdbase-app.json",
    "manifest.webmanifest",
    "service-worker.js",
    "runtime.wasm",
    "sqlite3.wasm",
    "sqlite-init.js",
    "mdbase-shell-runtime.js",
  ];
  const assets = paths.map((path, i) => ({
    path,
    bytes: 1,
    sha256:
      i === 4
        ? "d".repeat(64)
        : i === 5
          ? "e".repeat(64)
          : i === 6
            ? "f".repeat(64)
            : digest,
  }));
  const receipt = {
    ...createReceipt({
      target,
      sourceSha: sha,
      sourceTree: tree,
      sdkTrust,
      assets,
    }),
    run: { repository: environment.GITHUB_REPOSITORY, id: "11", attempt: "2" },
    status: "prepared",
  };
  const f = {
    receipt,
    target,
    sourceSha: sha,
    sourceTree: tree,
    sdkTrust,
    environment,
  };
  validatePreparedReceipt(f);
  for (const mutate of [
    (r) => {
      r.source.tree = "d".repeat(40);
    },
    (r) => {
      r.target.name = "production";
    },
    (r) => {
      r.run.attempt = "1";
    },
    (r) => {
      r.sdkTrust.sdk.native.sha256 = "a".repeat(64);
    },
    (r) => {
      r.status = "uploaded";
    },
    (r) => {
      r.assets = r.assets.filter((a) => a.path !== "sqlite-init.js");
    },
  ]) {
    const altered = structuredClone(receipt);
    mutate(altered);
    assert.throws(() => validatePreparedReceipt({ ...f, receipt: altered }));
  }
});
test("served checks refuse upload-success without successfully captured actual deployment UUID", () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  const environment = {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_SHA: sha,
    NATIVE_SOURCE_SHA: sha,
    GITHUB_REPOSITORY: "mdbase-dev/tasknotes-app",
    GITHUB_RUN_ID: "11",
    GITHUB_RUN_ATTEMPT: "2",
  };
  const receipt = {
    ...createReceipt({
      target,
      sourceSha: sha,
      sourceTree: tree,
      deployment: { id, url: "https://abc.tasknotes-app.pages.dev" },
    }),
    status: "uploaded",
    run: { repository: environment.GITHUB_REPOSITORY, id: "11", attempt: "2" },
  };
  assertCapturedDeployment({ receipt, deploymentId: id, environment, target });
  for (const deploymentId of [undefined, "", "abc123", "-".repeat(36)])
    assert.throws(
      () =>
        assertCapturedDeployment({
          receipt,
          deploymentId,
          environment,
          target,
        }),
      /UUID/,
    );
  for (const mutate of [
    (r) => {
      r.deployment = null;
    },
    (r) => {
      r.deployment.id = "99999999-1234-1234-1234-123456789abc";
    },
    (r) => {
      r.status = "uploading";
    },
    (r) => {
      r.status = "failed";
    },
    (r) => {
      r.source.sha = "f".repeat(40);
    },
    (r) => {
      r.run.attempt = "1";
    },
  ]) {
    const altered = structuredClone(receipt);
    mutate(altered);
    assert.throws(() =>
      assertCapturedDeployment({
        receipt: altered,
        deploymentId: id,
        environment,
        target,
      }),
    );
  }
});

for (const value of [undefined, "f".repeat(64)])
  test(`protected hash refusal retains failed evidence BEFORE APIs/tool/upload: ${value ? "mismatch" : "missing"}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "tn-refusal-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const environment = {
      RUNNER_TEMP: directory,
      NATIVE_EVIDENCE_PATH: join(directory, "evidence"),
      GITHUB_EVENT_NAME: "workflow_dispatch",
      NATIVE_TARGET: "staging",
      NATIVE_SOURCE_SHA: sha,
      GITHUB_SHA: sha,
      GITHUB_REF: "refs/heads/release/native-staging",
      GITHUB_REPOSITORY: "unit-test/tasknotes",
      GITHUB_RUN_ID: "11",
      GITHUB_RUN_ATTEMPT: "2",
      NATIVE_TRUST_ASSET_SHA256: value,
      NATIVE_SDK_SHA256:
        "15eb64b50fc7c2809ff3dba9cce5104fe48d8592208b3af8acb529862a1af18c",
      NATIVE_UI_SHA256:
        "e3da3c19b49ee90d3d19df2ea4a1a387b158decfccc8000371f93170eb30b723",
      NATIVE_PROTOCOL_SHA256:
        "cd1e15236ab7e25c511a4ba13af6a9df23f4b41715161479bba97b0445e1c138",
    };
    const historicalRoot = await frozenStagingRoot(t);
    let checks = 0,
      networkCalls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      networkCalls++;
      throw new Error("Network forbidden in input-refusal regression");
    });
    await assert.rejects(
      upload(environment, {
        checkout: async () => {},
        intake: async (options) => {
          checks++;
          assert.equal(options.approvedHashes.asset, value);
          return verifyTargetIntake({ ...options, root: historicalRoot }); // original frozen STAGING inputs + real four-hash guard
        },
      }),
      /protected raw trust ASSET/,
    );
    assert.equal(checks, 1);
    assert.equal(networkCalls, 0); // no Source API, Cloudflare, tooling or upload path
    const receipt = JSON.parse(
      await readFile(
        join(environment.NATIVE_EVIDENCE_PATH, "receipt.json"),
        "utf8",
      ),
    );
    assert.equal(receipt.status, "failed");
    assert.match(receipt.failure, /protected raw trust ASSET/);
    assert.equal(receipt.deployment, null);
    assert.equal(receipt.source.sha, sha);
    assert.equal(receipt.run.attempt, "2");
    assert.equal(receipt.run.repository, "unit-test/tasknotes");
    await assert.rejects(
      readFile(join(environment.NATIVE_EVIDENCE_PATH, "artifact.zip")),
      /ENOENT/,
    );
  });

test("shared helper remains EXACT qualified bytes", async () => {
  const bytes = await readFile(
    new URL("./lib/native-publish-bytes.mjs", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "a4336258cea726285573e9e667bba1c1ad6797fdba331715d0f17ea67ea5c66a",
  );
});
test("protected uploader source has no app install/build, SDK execution, automatic retries or artifact hooks", async () => {
  const code = await readFile(
    new URL("./native-publisher-upload.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    code,
    /pnpm|npm install|appReleaseTrust\(|import\(.*artifact|pending_deployments/,
  );
  assert.match(code, /"--no-bundle"/);
  assert.match(code, /"--force"/);
  const compact = code.replace(/\s+/g, "");
  const inventoryAt = compact.indexOf(
    'awaitassertInventory(join(artifact,"dist"),receipt.assets)',
  );
  const headAt = compact.indexOf(
    "awaitassertCurrentReleaseHead({target,sourceSha})",
  );
  const uploadAt = compact.indexOf("awaitexec(process.execPath");
  assert.ok(inventoryAt >= 0 && headAt > inventoryAt && uploadAt > headAt);
  assert.ok(
    code.indexOf('receipt.status = "uploaded"') <
      code.indexOf("receipt.served = await verifyServedAssets"),
  );
});
test("deploy-tool closure is dedicated, exact Wrangler 4.114.0 and integrity-locked, not app workspace", async () => {
  const pkg = JSON.parse(
    await readFile(
      new URL("./native-publish-tooling/package.json", import.meta.url),
    ),
  );
  assert.deepEqual(pkg.dependencies, { wrangler: "4.114.0" });
  assert.equal(pkg.scripts, undefined);
  const lock = await readFile(
    new URL("./native-publish-tooling/pnpm-lock.yaml", import.meta.url),
    "utf8",
  );
  assert.match(lock, /wrangler:\s+specifier: 4\.114\.0/);
  assert.match(lock, /resolution: \{integrity: sha512-/);
  assert.doesNotMatch(lock, /@mdbase-dev|file:vendor|link:|workspace:/);
});
const security = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy":
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
};
test("trusted headers are independent of HTTP200/source markers, including manifest/worker/cache policy", () => {
  assert.throws(
    () => assertTrustedHeaders(new Response("marker"), "/"),
    /header mismatch/,
  );
  assertTrustedHeaders(new Response("x", { headers: security }), "/");
  for (const [path, value] of [
    ["/.well-known/mdbase-app.json", "no-store"],
    ["/service-worker.js", "no-cache"],
    ["/offline-assets.json", "no-cache"],
    ["/assets/app.js", "public, max-age=31536000, immutable"],
  ]) {
    assert.throws(
      () =>
        assertTrustedHeaders(new Response("x", { headers: security }), path),
      /header mismatch/,
    );
    assertTrustedHeaders(
      new Response("x", { headers: { ...security, "cache-control": value } }),
      path,
    );
  }
});
test("full bytes and independent trusted static header/route checks; worker/control never false execution proof", async () => {
  const files = {
    "index.html": "shell",
    "404.html": "not found",
    ".well-known/mdbase-app.json": "{}",
    "manifest.webmanifest": "{}",
    "service-worker.js": "sw",
    "mdbase-shell-runtime.js": "// runtime",
    "runtime.wasm": "wasm",
    "sqlite3.wasm": "sqlite",
    _headers: "source policy",
    _redirects: "source routes",
    "_worker.js": "executed?",
    ".nojekyll": "\n",
  };
  const assets = Object.entries(files).map(([path, bytes]) => ({
    path,
    bytes: Buffer.byteLength(bytes),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }));
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    assert.notEqual(path, "/_worker.js");
    const missing =
      path.includes("__native_publisher_missing__") ||
      path.includes("__native_policy_unknown__");
    const body = missing
      ? files["404.html"]
      : (files[path.slice(1)] ?? files["index.html"]);
    const headers = { ...security };
    if (path === "/.well-known/mdbase-app.json")
      headers["cache-control"] = "no-store";
    if (
      [
        "/manifest.webmanifest",
        "/service-worker.js",
        "/offline-assets.json",
      ].includes(path)
    )
      headers["cache-control"] = "no-cache";
    return new Response(body, { status: missing ? 404 : 200, headers });
  };
  const bad404 = async (url, options) => {
    const response = await fetchImpl(url, options);
    if (response.status === 404)
      return new Response(response.body, {
        status: 200,
        headers: response.headers,
      });
    return response;
  };
  await assert.rejects(
    verifyServedAssets({ origin: target.appOrigin, assets, fetchImpl: bad404 }),
    /mismatch/,
  );
  const served = await verifyServedAssets({
    origin: target.appOrigin,
    assets,
    fetchImpl,
  });
  await assert.rejects(
    verifyTrustedHostingPolicy({
      origin: target.appOrigin,
      assets,
      served,
      fetchImpl: bad404,
    }),
    /policy readback failed/,
  );
  assert.ok(served.unverified.some((a) => a.path === "_worker.js"));
  assert.ok(
    served.verified.some(
      (a) =>
        a.path === ".nojekyll" && a.url === target.appOrigin + "/.nojekyll",
    ),
  );
  for (const status of [200, 404])
    await assert.rejects(
      verifyServedAssets({
        origin: target.appOrigin,
        assets,
        attempts: 1,
        fetchImpl: async (url, options) =>
          url.endsWith("/.nojekyll")
            ? new Response("not the marker bytes", {
                status,
                headers: security,
              })
            : fetchImpl(url, options),
      }),
      /mismatch/,
    );
  const policy = await verifyTrustedHostingPolicy({
    origin: target.appOrigin,
    assets,
    served,
    fetchImpl,
  });
  assert.deepEqual(
    policy.verifiedControls.map((a) => a.path),
    ["_headers", "_redirects"],
  );
  assert.deepEqual(
    policy.unverified.map((a) => a.path),
    ["_worker.js"],
  );
  const unknown = ["_routes.json", "nested/.nojekyll", "nested/_headers"].map(
    (path) => ({ path, bytes: 1, sha256: digest }),
  );
  const notCleared = await verifyTrustedHostingPolicy({
    origin: target.appOrigin,
    assets: [...assets, ...unknown],
    served,
    fetchImpl,
  });
  assert.deepEqual(
    notCleared.unverified.map((a) => a.path),
    ["_worker.js", ...unknown.map((a) => a.path)],
  );
  await assert.rejects(
    verifyTrustedHostingPolicy({
      origin: target.appOrigin,
      assets,
      served: { ...served, hostingHeaders: [] },
      fetchImpl,
    }),
    /remain unverified/,
  );
  await assert.rejects(
    verifyTrustedHostingPolicy({
      origin: target.appOrigin,
      assets,
      served,
      fetchImpl: async () => new Response("shell", { headers: security }),
    }),
    /policy readback failed/,
  );
});
for (const mode of ["traversal", "symlink", "extra", "duplicate", "size"])
  test(`ZIP extraction ${mode} negative, no artifact scripts executed`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "tn-artifact-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const archive = join(dir, "a.zip");
    await exec("python3", [
      "-I",
      "-B",
      "-c",
      `import sys,zipfile,stat\np=sys.argv[1]; mode=sys.argv[2]\nwith zipfile.ZipFile(p,'w') as z:\n z.writestr('receipt.json','{}')\n z.writestr('dist/index.html','x')\n if mode=='traversal': z.writestr('../escape','x')\n if mode=='extra': z.writestr('scripts/evil.js','x')\n if mode=='duplicate': z.writestr('dist/index.html','x')\n if mode=='size': z.writestr('dist/huge',b'x'*(128*1024*1024+1),compress_type=zipfile.ZIP_DEFLATED)\n if mode=='symlink':\n  v=zipfile.ZipInfo('dist/link'); v.external_attr=(stat.S_IFLNK|0o777)<<16; z.writestr(v,'/etc/passwd')`,
      archive,
      mode,
    ]);
    await assert.rejects(
      exec("python3", [
        "-I",
        "-B",
        new URL("./native-artifact-extract.py", import.meta.url).pathname,
        archive,
        join(dir, "out"),
      ]),
    );
  });
test("ZIP valid extraction is read-only; only receipt/dist data retained", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "tn-artifact-"));
  t.after(async () => {
    await exec("chmod", ["-R", "u+w", dir]);
    await rm(dir, { recursive: true, force: true });
  });
  const archive = join(dir, "a.zip");
  await exec("python3", [
    "-I",
    "-B",
    "-c",
    "import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n z.writestr('receipt.json','{}')\n z.writestr('dist/.well-known/app.json','original')",
    archive,
  ]);
  const out = join(dir, "out");
  await exec("python3", [
    "-I",
    "-B",
    new URL("./native-artifact-extract.py", import.meta.url).pathname,
    archive,
    out,
  ]);
  assert.equal(
    await readFile(join(out, "dist/.well-known/app.json"), "utf8"),
    "original",
  );
});

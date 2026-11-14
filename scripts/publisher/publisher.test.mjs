// Public data and transport doubles; no deployment or credentials.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { assertDispatch, assertCheckout, assertAncestor } from "./refs.mjs";
import { productionPin } from "./originals.mjs";
import { authenticateProduction, stagingArchive } from "./authentication.mjs";
import { capturePrevious, rollback } from "./rollback.mjs";
import { assertArtifactMetadata, assertArtifactRun } from "./artifact.mjs";

import {
  CAPTURE_DELAYS,
  captureDeployment,
  createReceipt,
  sourceRoot,
} from "./publisher.mjs";
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const source = "a".repeat(40),
  tree = "b".repeat(40);
const uuid = "12345678-1234-4234-8234-123456789abc";
const env = {
  TARGET: "staging",
  SOURCE_SHA: source,
  GITHUB_SHA: tree,
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "workflow_dispatch",
};
const expected = {
  id: "10",
  digest: "sha256:" + "c".repeat(64),
  repository: "mdbase-dev/mdbase-connect",
  repositoryId: "20",
  run: "30",
  attempt: "1",
  event: "workflow_dispatch",
  ref: env.GITHUB_REF,
  workflowSha: tree,
  source,
  tree,
  target: "staging",
};
const metadata = {
  id: 10,
  expired: false,
  digest: expected.digest,
  name: "tasknotes-build-staging-30-1",
  workflow_run: { id: 30, head_sha: tree, head_repository_id: 20 },
};
const run = {
  id: 30,
  head_sha: tree,
  run_attempt: 1,
  event: expected.event,
  head_branch: "main",
  path: ".github/workflows/deploy-tasknotes.yml",
  repository: { id: 20, full_name: expected.repository },
};
const deployment = {
  id: uuid,
  url: "https://12345678.tasknotes-app.pages.dev",
  sourceSha: source,
  pagesBranch: "staging",
};
const sha = (b) => createHash("sha256").update(b).digest("hex");

it("admits an exact clean ancestor even when main and the dispatch SHA move ahead", async () => {
  const root = await mkdtemp(join(tmpdir(), "editor-ancestry-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    git("init");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Test");
    git("commit", "--allow-empty", "-m", "source");
    const sha = git("rev-parse", "HEAD");
    git("commit", "--allow-empty", "-m", "main advanced");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "--detach", sha);
    const binding = assertDispatch({ ...env, SOURCE_SHA: sha });
    assert.equal(assertCheckout(binding, root).sha, sha);
    git("checkout", "--orphan", "unrelated");
    git("commit", "--allow-empty", "-m", "not main");
    const other = git("rev-parse", "HEAD");
    assert.throws(
      () => assertCheckout({ ...binding, sha: other }, root),
      /ancestor/,
    );
    assert.throws(
      () => assertAncestor({ ...binding, sha: other }, root),
      /ancestor/,
    );
    for (const patch of [
      { SOURCE_SHA: "abcd" },
      { GITHUB_EVENT_NAME: "push" },
      { GITHUB_REF: "refs/tags/v1" },
      { TARGET: "lab" },
    ])
      assert.throws(() => assertDispatch({ ...env, ...patch }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("checks exact npm integrity and authenticated publisher source before accepting the production archive", async () => {
  const { pin, bytes } = await productionPin(repoRoot);
  const options = {
    fetchImpl: async () =>
      Response.json({
        name: "@mdbase-dev/sdk",
        version: pin.version,
        dist: { integrity: pin.sri },
      }),
    prove: async (name, baseline) => {
      assert.equal(name, "@mdbase-dev/sdk");
      assert.equal(baseline.workflow, "publish-sdk-npm.yml");
      return {
        commit: pin.sourceCommit,
        identity: `https://github.com/mdbase-dev/mdbase-connect/.github/workflows/publish-sdk-npm.yml@${pin.publication.ref}`,
      };
    },
  };
  await authenticateProduction(pin, bytes, options);
  await assert.rejects(
    authenticateProduction(pin, Buffer.from("wrong"), options),
    /integrity/,
  );
  await assert.rejects(
    authenticateProduction(pin, bytes, {
      ...options,
      prove: async () => ({ commit: source }),
    }),
    /source mismatch/,
  );
  await assert.rejects(
    authenticateProduction(pin, bytes, {
      ...options,
      prove: async () => {
        throw Error("bad certificate");
      },
    }),
    /certificate/,
  );
});
it("pins staging to the production version and verifies both release digests and the repository/workflow/source attestation", async () => {
  const { pin } = await productionPin(repoRoot),
    bytes = Buffer.from("staging"),
    proof = Buffer.from("{}");
  const prefix = `https://github.com/mdbase-dev/mdbase-connect/releases/download/sdk-v${pin.version}/`;
  const release = {
    tag_name: "sdk-v" + pin.version,
    prerelease: true,
    draft: false,
    assets: [
      {
        name: "sdk-staging.tgz",
        digest: "sha256:" + sha(bytes),
        browser_download_url: prefix + "sdk-staging.tgz",
      },
      {
        name: "sdk-staging.tgz.sigstore.json",
        digest: "sha256:" + sha(proof),
        browser_download_url: prefix + "sdk-staging.tgz.sigstore.json",
      },
    ],
  };
  let called = false;
  const options = {
    fetchImpl: async (url) =>
      url.includes("api.github.com")
        ? Response.json(release)
        : new Response(url.endsWith(".json") ? proof : bytes),
    run: (command, args) => {
      called = true;
      assert.equal(command, "gh");
      assert.ok(args.includes("--bundle"));
      assert.ok(args.includes(pin.sourceCommit));
      assert.ok(
        args.includes(
          "mdbase-dev/mdbase-connect/.github/workflows/publish-sdk-npm.yml",
        ),
      );
    },
  };
  assert.equal(
    (await stagingArchive(pin, options)).authentication.sha256,
    sha(bytes),
  );
  assert.equal(called, true);
  await assert.rejects(
    stagingArchive(pin, {
      ...options,
      fetchImpl: async (url) =>
        url.includes("api.github.com")
          ? Response.json(release)
          : new Response("wrong"),
    }),
    /digest mismatch/,
  );
  await assert.rejects(
    stagingArchive(pin, {
      ...options,
      run: () => {
        throw Error("invalid signature");
      },
    }),
    /attestation verification failed/,
  );
});
it("rolls production back, verifies the previous id and every transitive asset, and keeps failure evidence", async () => {
  const previousId = "87654321-1234-4234-8234-123456789abc",
    previousUrl = "https://87654321.tasknotes-app.pages.dev",
    failedId = "12345678-1234-4234-8234-123456789abc";
  let active = previousId,
    commit = null;
  const calls = [];
  const source = "c".repeat(40),
    clock = {
      t: 0,
      now: () => clock.t,
      sleep: async (ms) => {
        clock.t += ms;
      },
    },
    recovery = { source, ...clock };
  const bodies = {
    "/": '<script type="module" src="/assets/entry.js"></script><link href="/style.css" rel="stylesheet">',
    "/assets/entry.js":
      'import("./chunk.js");fetch("/wasm/pandoc-1.0.0.wasm");fetch("assets/engine.wasm");fetch("./gone.wasm");new URL("./workers.v1/pool.js",import.meta.url)',
    "/assets/chunk.js": 'new URL("worker.js",import.meta.url)',
    "/assets/engine.wasm": "previous wasm",
    "/assets/worker.js": "previous worker",
    "/assets/workers.v1/pool.js": "previous pool",
    "/style.css": "previous style",
  };
  const options = {
    accountId: "a".repeat(32),
    apiToken: "test-double",
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method });
      if (url.includes("/rollback")) {
        active = previousId;
        return Response.json({ success: true, result: { id: previousId } });
      }
      if (url.includes("api.cloudflare.com"))
        return Response.json({
          success: true,
          result: {
            name: "tasknotes-app",
            production_branch: "main",
            canonical_deployment: {
              id: active,
              url: previousUrl,
              environment: "production",
              deployment_trigger: { metadata: { commit_hash: commit } },
            },
          },
        });
      const path = new URL(url).pathname;
      if (path.endsWith(".json")) return new Response("manifest");
      if (path.endsWith(".wasm") && !bodies[path])
        return new Response("<html>spa</html>", {
          headers: { "content-type": "text/html" },
        });
      return new Response(bodies[path] ?? "previous asset");
    },
  };
  const previous = await capturePrevious(options);
  for (const path of [
    "/assets/entry.js",
    "/assets/chunk.js",
    "/assets/worker.js",
    "/assets/workers.v1/pool.js",
    "/assets/engine.wasm",
    "/style.css",
  ])
    assert.ok(
      previous.probes.some((p) => p.path === path),
      path,
    );
  assert.ok(
    !previous.probes.some((p) => p.path === "/assets/gone.wasm"),
    "SPA fallback is not a build asset",
  );
  assert.ok(
    !previous.probes.some((p) => p.path.startsWith("/wasm/")),
    "a guessed path serving SPA fallback is not a static asset",
  );
  const plan = { target: "production", origin: "https://app.tasknotes.dev" };
  active = failedId;
  commit = source;
  const report = await rollback(previous, options, recovery);
  assert.equal(report.ok, true);
  assert.equal(report.restored, true);
  assert.equal(report.previousId, previousId);
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  assert.equal(
    createReceipt({
      plan,
      verification: { ok: false },
      previous,
      rollback: report,
    }).rollback.ok,
    true,
  );
  const untouched = await rollback(previous, options, recovery);
  assert.equal(untouched.ok, true);
  assert.equal(untouched.restored, false);
  assert.equal(
    calls.filter((c) => c.method === "POST").length,
    1,
    "nothing to undo when the previous deployment is active",
  );
  active = failedId;
  commit = "d".repeat(40);
  const newer = await rollback(previous, options, recovery);
  assert.equal(newer.ok, false);
  assert.equal(newer.refused, true);
  assert.equal(
    calls.filter((c) => c.method === "POST").length,
    1,
    "a newer publication is never undone",
  );
  active = previousId;
  commit = source;
  let reads = 0;
  const late = await rollback(
    previous,
    {
      ...options,
      fetchImpl: async (url, init) => {
        if (url.endsWith("/tasknotes-app") && ++reads === 2) active = failedId;
        return options.fetchImpl(url, init);
      },
    },
    recovery,
  );
  assert.equal(late.ok, true);
  assert.equal(
    late.restored,
    true,
    "an upload that lands during verification is still undone",
  );
  assert.equal(active, previousId);
  for (const probe of previous.probes) {
    const broken = await rollback(
      previous,
      {
        ...options,
        fetchImpl: async (url, init) =>
          url === plan.origin + probe.path
            ? new Response("wrong bytes")
            : options.fetchImpl(url, init),
      },
      { source, settleMs: 100 },
    );
    assert.equal(broken.ok, false, "rollback must match " + probe.path);
  }
  const staleHeaders = (path, type) => async (url, init) => {
    if (url !== plan.origin + path) return options.fetchImpl(url, init);
    const response = await options.fetchImpl(url, init);
    return new Response(response.body, {
      headers: {
        "content-type": type,
        "content-security-policy": "default-src 'self'",
      },
    });
  };
  assert.equal(
    (
      await rollback(
        previous,
        {
          ...options,
          fetchImpl: staleHeaders("/assets/engine.wasm", "application/wasm"),
        },
        recovery,
      )
    ).ok,
    true,
    "unchanged bytes may keep another build's headers at the edge",
  );
  const htmlPrevious = {
    ...previous,
    probes: previous.probes.map((p) =>
      p.path === "/"
        ? { ...p, headers: { ...p.headers, "content-type": "text/html" } }
        : p,
    ),
  };
  assert.equal(
    (
      await rollback(
        htmlPrevious,
        { ...options, fetchImpl: staleHeaders("/", "text/html") },
        { source, settleMs: 100 },
      )
    ).ok,
    false,
    "documents must match exactly",
  );
  await assert.rejects(
    capturePrevious({
      ...options,
      fetchImpl: async (url, init) =>
        url === plan.origin + "/assets/entry.js"
          ? new Response("missing", { status: 404 })
          : options.fetchImpl(url, init),
    }),
    /bytes unavailable/,
  );
  assert.equal(
    createReceipt({
      plan,
      verification: { ok: false },
      previous,
      rollback: report,
    }).status,
    "failed-or-incomplete",
  );
});
it("binds immutable artifact metadata AND the exact workflow/run attempt/manual ref", () => {
  assertArtifactMetadata(metadata, expected);
  assertArtifactRun(run, expected);
  for (const patch of [
    { expired: true },
    { digest: "sha256:" + "d".repeat(64) },
    { name: "tasknotes-build-staging-30-2" },
    { workflow_run: { ...metadata.workflow_run, head_repository_id: 99 } },
  ])
    assert.throws(() =>
      assertArtifactMetadata({ ...metadata, ...patch }, expected),
    );
  for (const patch of [
    { run_attempt: 2 },
    { event: "push" },
    { head_branch: "other" },
    { path: ".github/workflows/native-tasknotes.yml" },
    { head_sha: source },
  ])
    assert.throws(() => assertArtifactRun({ ...run, ...patch }, expected));
});
it("uses page20 and resolves only the unique uploaded URL/full source/channel to a FULL UUID", async () => {
  const entry = {
    id: uuid,
    url: deployment.url,
    deployment_trigger: {
      metadata: { commit_hash: source, branch: "staging" },
    },
  };
  const options = {
    output: "Success " + deployment.url,
    target: "staging",
    sha: source,
    accountId: "a".repeat(32),
    apiToken: "fixture",
    sleep: async () => {},
  };
  const capture = (rows) =>
    captureDeployment({
      ...options,
      fetchImpl: async (url) => {
        assert.match(url, /\/tasknotes-app\/deployments\?per_page=20$/);
        return Response.json({ success: true, result: rows });
      },
    });
  assert.deepEqual(await capture([entry]), deployment);
  // Re-uploading identical source is not a source conflict: identify the new URL.
  const prior = {
    ...entry,
    id: "87654321-1234-4234-8234-123456789abc",
    url: "https://87654321.tasknotes-app.pages.dev",
  };
  assert.deepEqual(await capture([entry, prior]), deployment);
  for (const bad of [
    { ...entry, id: "12345678" },
    { ...entry, url: "https://87654321.tasknotes-app.pages.dev" },
    {
      ...entry,
      deployment_trigger: {
        metadata: { commit_hash: tree, branch: "staging" },
      },
    },
    {
      ...entry,
      deployment_trigger: { metadata: { commit_hash: source, branch: "main" } },
    },
  ])
    await assert.rejects(capture([bad]), /UUID/);
  await assert.rejects(capture([entry, entry]), /UUID/);
});

it("reads candidate data from the source root, not the workflow checkout", () => {
  assert.equal(
    sourceRoot({ TASKNOTES_SOURCE_ROOT: "/candidate" }),
    "/candidate",
  );
  assert.equal(sourceRoot({}), process.cwd());
});

describe("captureDeployment bounded GET-only re-read", () => {
  const entry = {
    id: uuid,
    url: deployment.url,
    deployment_trigger: {
      metadata: { commit_hash: source, branch: "staging" },
    },
  };
  const listed = (rows) => Response.json({ success: true, result: rows });
  const capture = (replies) => {
    const calls = [],
      sleeps = [];
    const run = captureDeployment({
      output: "Success " + deployment.url,
      target: "staging",
      sha: source,
      accountId: "a".repeat(32),
      apiToken: "fixture",
      fetchImpl: async (url, init) => {
        calls.push([url, init.method ?? "GET"]);
        const reply = replies[Math.min(calls.length, replies.length) - 1];
        if (reply instanceof Error) throw reply;
        return reply();
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    return { run, calls, sleeps };
  };
  const budget = CAPTURE_DELAYS.reduce((sum, delay) => sum + delay, 0);
  const refusal = (message) =>
    new RegExp(
      `^Error: TaskNotes publisher refusal: ${message.replaceAll("/", "\\/")}$`,
    );

  it("re-reads until the list catches up with the upload", async () => {
    const { run, calls, sleeps } = capture([
      () => listed([]),
      () => listed([]),
      () => listed([entry]),
    ]);
    assert.deepEqual(await run, deployment);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(([, method]) => method === "GET"));
    assert.deepEqual(sleeps, CAPTURE_DELAYS.slice(0, 2));
  });

  it("retries a 429 honouring Retry-After, and a 5xx or network error", async () => {
    const { run, calls, sleeps } = capture([
      () =>
        new Response(null, { status: 429, headers: { "retry-after": "20" } }),
      () => new Response(null, { status: 503 }),
      new Error("socket hang up"),
      () => listed([entry]),
    ]);
    assert.deepEqual(await run, deployment);
    assert.equal(calls.length, 4);
    assert.deepEqual(sleeps, [20000, CAPTURE_DELAYS[1], CAPTURE_DELAYS[2]]);
  });

  it("caps Retry-After to the fixed bound and then refuses", async () => {
    const { run, calls, sleeps } = capture([
      () =>
        new Response(null, { status: 429, headers: { "retry-after": "600" } }),
    ]);
    await assert.rejects(run, refusal("deployment UUID lookup failed"));
    assert.equal(calls.length, CAPTURE_DELAYS.length + 1);
    assert.equal(
      sleeps.reduce((sum, ms) => sum + ms, 0),
      budget,
    );
  });

  it("refuses with the unchanged message once the bound is exhausted", async () => {
    const { run, calls, sleeps } = capture([() => listed([])]);
    await assert.rejects(
      run,
      refusal("actual deployment UUID/source/channel mismatch"),
    );
    assert.equal(calls.length, CAPTURE_DELAYS.length + 1);
    assert.deepEqual(sleeps, CAPTURE_DELAYS);
  });

  it("refuses more than one match immediately", async () => {
    const { run, calls, sleeps } = capture([() => listed([entry, entry])]);
    await assert.rejects(
      run,
      refusal("actual deployment UUID/source/channel mismatch"),
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(sleeps, []);
  });

  it("refuses a malformed id immediately", async () => {
    const { run, calls } = capture([
      () => listed([{ ...entry, id: "12345678" }]),
    ]);
    await assert.rejects(
      run,
      refusal("actual deployment UUID/source/channel mismatch"),
    );
    assert.equal(calls.length, 1);
  });

  for (const status of [400, 401, 403, 404])
    it(`refuses a ${status} immediately`, async () => {
      const { run, calls, sleeps } = capture([
        () => new Response(null, { status }),
      ]);
      await assert.rejects(run, refusal("deployment UUID lookup failed"));
      assert.equal(calls.length, 1);
      assert.deepEqual(sleeps, []);
    });
});

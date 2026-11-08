import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { createRequire } from "node:module";
const { parse } = createRequire(
  new URL("../../node_modules/@mdbase-dev/sdk/package.json", import.meta.url),
)("yaml");
import { prepareInstall } from "./install-inputs.mjs";
import { compareInstalled, productionPin } from "./originals.mjs";
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
it("authenticates staging installation without weakening original digest or installed-member gates", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "tasknotes-intake-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-job-token";
  context.after(() => {
    if (previous === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previous;
  });
  const { pin, spec } = await productionPin(repoRoot);
  const appRoot = root;
  await mkdir(appRoot, { recursive: true });
  await mkdir(join(root, "vendor"));
  await cp(join(repoRoot, "package.json"), join(appRoot, "package.json"));
  const lockName = "pnpm-lock.yaml";
  const lock = await readFile(join(repoRoot, lockName));
  await writeFile(join(root, lockName), lock);
  const installed = join(appRoot, "node_modules/@mdbase-dev/sdk");
  await mkdir(installed, { recursive: true });
  await writeFile(
    join(installed, "package.json"),
    JSON.stringify({ name: "@mdbase-dev/sdk-staging", version: pin.version }),
  );
  await writeFile(join(installed, "index.js"), "export const value=1;");
  const packed = join(root, "packed");
  await mkdir(packed);
  await cp(installed, join(packed, "package"), { recursive: true });
  const bytes = execFileSync("tar", ["-czf", "-", "-C", packed, "package"]);
  const tag = "sdk-v" + pin.version;
  const url =
    "https://github.com/mdbase-dev/mdbase-connect/releases/download/" +
    tag +
    "/sdk-staging.tgz";
  const metadata =
    "https://api.github.com/repos/mdbase-dev/mdbase-connect/releases/tags/" +
    tag;
  const asset =
    "https://api.github.com/repos/mdbase-dev/mdbase-connect/releases/assets/100";
  const original = {
    name: "@mdbase-dev/sdk",
    path: url,
    sha256: sha(bytes),
    sri: "sha512-" + createHash("sha512").update(bytes).digest("base64"),
  };
  const plan = {
    target: "staging",
    sdkTrust: {
      archives: { sdk: original },
      production: { version: pin.version, sri: pin.sri, path: spec.slice(5) },
      lockSha256: sha(lock),
    },
  };
  const seen = [];
  const fetchImpl = async (request, init) => {
    seen.push(request);
    assert.equal(init.headers.authorization, "Bearer test-job-token");
    if (request === metadata)
      return Response.json({
        tag_name: tag,
        prerelease: true,
        draft: false,
        assets: [
          {
            id: 100,
            name: "sdk-staging.tgz",
            digest: "sha256:" + sha(bytes),
            browser_download_url: url,
          },
        ],
      });
    assert.equal(request, asset);
    assert.equal(init.headers.accept, "application/octet-stream");
    return new Response(bytes);
  };
  const wrong = async (request, init) =>
    request === metadata
      ? fetchImpl(request, init)
      : new Response("wrong bytes");
  await assert.rejects(
    prepareInstall(plan, root, wrong),
    /Staging original changed/,
  );
  seen.length = 0;
  await prepareInstall(plan, root, fetchImpl);
  assert.deepEqual(await readFile(join(root, "vendor/sdk-staging.tgz")), bytes);
  await compareInstalled(root, { sdk: original }, { fetchImpl });
  assert.deepEqual(seen, [metadata, asset, metadata, asset]);
  await assert.rejects(
    compareInstalled(root, { sdk: original }, { fetchImpl: wrong }),
    /comparison archive changed/,
  );
  await writeFile(join(installed, "index.js"), "changed installed member");
  await assert.rejects(
    compareInstalled(root, { sdk: original }, { fetchImpl }),
    /ALL installed original/,
  );
});
it("keeps every job token read-only and limits new token wiring to intake, installation and comparison", async () => {
  const workflow = parse(
    await readFile(
      join(repoRoot, ".github/workflows/deploy-tasknotes.yml"),
      "utf8",
    ),
  );
  assert.deepEqual(workflow.permissions, { actions: "read", contents: "read" });
  assert.equal(workflow.env?.GITHUB_TOKEN, undefined);
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.env?.GITHUB_TOKEN, undefined);
    for (const permission of Object.values(
      job.permissions ?? workflow.permissions,
    ))
      assert.ok(["read", "none"].includes(permission));
  }
  const build = workflow.jobs.build;
  for (const command of [
    "publisher.mjs guard",
    "install-inputs.mjs",
    "build.mjs",
  ]) {
    const step = build.steps.find((step) =>
      step.run?.includes("/publisher/" + command),
    );
    assert.equal(step.env.GITHUB_TOKEN, "${{ github.token }}");
  }
  const install = build.steps.find((step) =>
    step.run?.startsWith("pnpm install"),
  );
  assert.equal(install.env?.GITHUB_TOKEN, undefined);
  const guard = workflow.jobs.publish.steps.find((step) =>
    step.run?.includes("publisher.mjs guard"),
  );
  assert.equal(guard.env.GITHUB_TOKEN, "${{ github.token }}");
  assert.equal(guard["timeout-minutes"], 7);
  assert.ok(
    guard["timeout-minutes"] * 60000 >
      5 * 30000 + 5000 + 20000 + 60000 + 120000,
  );
});
it("removes the job token before candidate module evaluation and hooks", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "tasknotes-build-token-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ dependencies: {} }),
  );
  await mkdir(join(directory, "scripts/publisher"), { recursive: true });
  await writeFile(
    join(directory, "scripts/publisher/candidate-build.mjs"),
    "if ('GITHUB_TOKEN' in process.env) process.exit(99); console.error('build-token-cleared'); process.exit(73);",
  );
  await writeFile(
    join(directory, "plan.json"),
    JSON.stringify({
      sha: "a".repeat(40),
      sdkTrust: { archives: {}, release: {} },
    }),
  );
  const result = spawnSync(
    process.execPath,
    [join(repoRoot, "scripts/publisher/build.mjs"), directory],
    {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: directory + ":" + process.env.PATH,
        GITHUB_TOKEN: "test-job-token",
      },
    },
  );
  assert.equal(result.status, 73);
  assert.match(result.stderr, /build-token-cleared/);
  assert.doesNotMatch(result.stderr, /test-job-token/);
  const wrapper = await readFile(
    join(repoRoot, "scripts/publisher/build.mjs"),
    "utf8",
  );
  const comparison = wrapper.indexOf("await compareInstalled("),
    removal = wrapper.indexOf("delete process.env.GITHUB_TOKEN");
  assert.ok(comparison >= 0 && comparison < removal);
  assert.ok(removal < wrapper.indexOf("await import("));
});

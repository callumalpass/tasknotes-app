import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUILD_LOOKUP_FAILED,
  BUILD_NOT_VISIBLE,
  BUILD_NUMBER_TAKEN,
  checkBuildNumberUnused,
  confirmUpload,
  findExactBuild,
  main,
} from "./testflight-upload.mjs";
import { UPLOAD_REFUSED } from "./testflight-upload-refusal.mjs";
import { APP_ID, BUNDLE_ID } from "./submit-app-store.mjs";

// Synthetic identifiers in the shape altool prints; none may leave the runner.
const secrets = [
  "ABCDE12345",
  "00000000-1111-2222-3333-444444444444",
  "reviewer@example.invalid",
  "TaskNotes.ipa",
];
const noise = `Delivery UUID: ${secrets[1]}\nTeam ${secrets[0]} ${secrets[2]} ${secrets[3]}\n`;
const noSleep = async () => {};

function buildPage(version, build, { bundleId = BUNDLE_ID } = {}) {
  return {
    data: [
      {
        type: "builds",
        id: "b1",
        attributes: { version: build, processingState: "PROCESSING" },
        relationships: {
          app: { data: { type: "apps", id: APP_ID } },
          preReleaseVersion: { data: { type: "preReleaseVersions", id: "p1" } },
        },
      },
    ],
    included: [
      { type: "apps", id: APP_ID, attributes: { bundleId } },
      { type: "preReleaseVersions", id: "p1", attributes: { version } },
    ],
  };
}

// Answers the exact-build query after `visibleAfter` lookups.
function fakeClient({
  visibleAfter = Infinity,
  existing = [],
  fail = false,
} = {}) {
  const requests = [];
  return {
    requests,
    async request(path) {
      requests.push(path);
      if (fail) throw new Error("HTTP 401");
      const query = new URL(path, "https://x.invalid/v1/").searchParams;
      assert.equal(query.get("filter[app]"), APP_ID);
      assert.equal(query.get("filter[preReleaseVersion.platform]"), "IOS");
      if (requests.length <= visibleAfter) return { data: [], included: [] };
      return buildPage(
        query.get("filter[preReleaseVersion.version]"),
        query.get("filter[version]"),
      );
    },
    async list(path) {
      requests.push(path);
      if (fail) throw new Error("HTTP 401");
      return existing.map((version) => ({
        type: "builds",
        attributes: { version },
      }));
    },
  };
}

test("altool exit 0 without the phrase succeeds once the exact build is visible", async () => {
  const client = fakeClient({ visibleAfter: 2 });
  const result = await confirmUpload({
    client,
    log: noise + "UPLOAD FINISHED\n",
    status: "0",
    version: "1.0.25",
    build: "47",
    sleepImpl: noSleep,
  });
  assert.deepEqual(result, { confirmed: true });
  assert.equal(client.requests.length, 3);
  const query = new URL(client.requests[0], "https://x.invalid/v1/")
    .searchParams;
  assert.equal(query.get("filter[version]"), "47");
  assert.equal(query.get("filter[preReleaseVersion.version]"), "1.0.25");
});

test("the API, not the phrase, decides: a visible build wins over a refusal-looking log", async () => {
  const result = await confirmUpload({
    client: fakeClient({ visibleAfter: 0 }),
    log: "ERROR something odd but exited 0",
    status: 0,
    version: "1.0.25",
    build: "47",
    sleepImpl: noSleep,
  });
  assert.deepEqual(result, { confirmed: true });
});

test("a build for another bundle, version or number is not a match", async () => {
  const client = {
    request: async () => buildPage("1.0.25", "47", { bundleId: "dev.other" }),
  };
  assert.equal(await findExactBuild(client, "1.0.25", "47"), false);
  const wrongVersion = { request: async () => buildPage("1.0.24", "47") };
  assert.equal(await findExactBuild(wrongVersion, "1.0.25", "47"), false);
  const wrongBuild = { request: async () => buildPage("1.0.25", "46") };
  assert.equal(await findExactBuild(wrongBuild, "1.0.25", "47"), false);
  await assert.rejects(findExactBuild(wrongBuild, "1.0.25", "47&x=1"));
});

test("altool exit 0 with the build never visible refuses with a bounded wait", async () => {
  for (const log of [
    "UPLOAD SUCCEEDED with no errors",
    "No errors uploading 'TaskNotes.ipa'",
    "UPLOAD FINISHED",
  ]) {
    const client = fakeClient();
    const sleeps = [];
    const result = await confirmUpload({
      client,
      log: noise + log,
      status: "0",
      version: "1.0.25",
      build: "47",
      attempts: 4,
      intervalMs: 30_000,
      sleepImpl: async (ms) => sleeps.push(ms),
    });
    assert.deepEqual(result, { confirmed: false, reason: BUILD_NOT_VISIBLE });
    assert.equal(client.requests.length, 4);
    assert.deepEqual(sleeps, [30_000, 30_000, 30_000]);
  }
  // Without a success hint, a recognisable Apple refusal names the cause.
  assert.deepEqual(
    await confirmUpload({
      client: fakeClient(),
      log: "ERROR ITMS-90382: Upload limit reached.",
      status: "0",
      version: "1.0.25",
      build: "47",
      attempts: 2,
      sleepImpl: noSleep,
    }),
    { confirmed: false, reason: "testflight-upload-limit" },
  );
  // Reads that never succeed are a lookup failure, not "not visible".
  assert.deepEqual(
    await confirmUpload({
      client: fakeClient({ fail: true }),
      log: "UPLOAD SUCCEEDED",
      status: "0",
      version: "1.0.25",
      build: "47",
      attempts: 3,
      sleepImpl: noSleep,
    }),
    { confirmed: false, reason: BUILD_LOOKUP_FAILED },
  );
});

test("a non-zero altool exit keeps the existing classification and never asks Apple", async () => {
  const client = fakeClient({ visibleAfter: 0 });
  for (const [log, reason] of [
    [
      "ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE",
      "testflight-build-number-duplicate",
    ],
    ["ERROR ITMS-90382: Upload limit reached.", "testflight-upload-limit"],
    ["Something new went wrong", "testflight-upload-unclassified"],
    [undefined, "testflight-upload-log-missing"],
  ])
    assert.deepEqual(
      await confirmUpload({
        client,
        log,
        status: "1",
        version: "1.0.25",
        build: "47",
        sleepImpl: noSleep,
      }),
      { confirmed: false, reason },
    );
  assert.equal(client.requests.length, 0);
});

test("build-number allocation skips a build App Store Connect already holds", async () => {
  // Run 47 reached Apple without confirmation; the next dispatch is run 48.
  const existing = ["45", "47"];
  assert.deepEqual(
    await checkBuildNumberUnused({
      client: fakeClient({ existing }),
      version: "1.0.25",
      build: "48",
    }),
    { ok: true, highest: 47 },
  );
  for (const build of ["47", "46"])
    assert.deepEqual(
      await checkBuildNumberUnused({
        client: fakeClient({ existing }),
        version: "1.0.25",
        build,
      }),
      { ok: false, reason: BUILD_NUMBER_TAKEN, highest: 47 },
    );
  // Numeric, not lexical: build 100 is higher than 99.
  assert.deepEqual(
    await checkBuildNumberUnused({
      client: fakeClient({ existing: ["99", "100"] }),
      version: "1.0.25",
      build: "100",
    }),
    { ok: false, reason: BUILD_NUMBER_TAKEN, highest: 100 },
  );
  assert.deepEqual(
    await checkBuildNumberUnused({
      client: fakeClient({ fail: true }),
      version: "1.0.25",
      build: "48",
    }),
    { ok: false, reason: BUILD_LOOKUP_FAILED },
  );
  const client = fakeClient({ existing: [] });
  await checkBuildNumberUnused({ client, version: "1.0.25", build: "48" });
  const query = new URL(client.requests[0], "https://x.invalid/v1/")
    .searchParams;
  assert.equal(query.get("filter[preReleaseVersion.version]"), "1.0.25");
});

test("the CLI prints and retains only fixed classes, never the log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "testflight-upload-"));
  const errors = [];
  const logs = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (line) => errors.push(String(line));
  console.log = (line) => logs.push(String(line));
  try {
    const log = join(dir, "upload.log");
    const summary = join(dir, "summary.md");
    await writeFile(log, noise + "UPLOAD SUCCEEDED\n");
    const env = {
      GITHUB_RUN_ID: "44398603643",
      GITHUB_WORKSPACE: dir,
      GITHUB_STEP_SUMMARY: summary,
      TASKNOTES_IOS_VERSION: "1.0.25",
      TASKNOTES_IOS_BUILD: "47",
    };
    const confirm = { attempts: 2, sleepImpl: noSleep };

    process.exitCode = undefined;
    await main(["confirm", log, "0"], env, {
      client: fakeClient(),
      confirm,
    });
    assert.equal(process.exitCode, 1);
    assert.deepEqual(errors, [
      `TestFlight upload refused: ${BUILD_NOT_VISIBLE}`,
    ]);
    const retained = await readFile(
      join(dir, "testflight-upload-result.json"),
      "utf8",
    );
    assert.deepEqual(JSON.parse(retained), {
      outcome: UPLOAD_REFUSED,
      reason: BUILD_NOT_VISIBLE,
      run_id: 44398603643,
    });
    const written = retained + (await readFile(summary, "utf8"));
    for (const secret of secrets) assert.ok(!written.includes(secret));

    // Missing credentials are a lookup failure, never a crash or a log dump.
    await rm(join(dir, "testflight-upload-result.json"));
    errors.length = 0;
    await main(["confirm", log, "0"], env);
    assert.deepEqual(errors, [
      `TestFlight upload refused: ${BUILD_LOOKUP_FAILED}`,
    ]);

    await rm(join(dir, "testflight-upload-result.json"));
    errors.length = 0;
    process.exitCode = undefined;
    await main(["confirm", log, "0"], env, {
      client: fakeClient({ visibleAfter: 0 }),
      confirm,
    });
    assert.equal(process.exitCode, undefined);
    assert.deepEqual(errors, []);
    await assert.rejects(readFile(join(dir, "testflight-upload-result.json")));

    await main(
      ["preflight"],
      { ...env, TASKNOTES_IOS_BUILD: "47" },
      {
        client: fakeClient({ existing: ["47"] }),
      },
    );
    assert.equal(process.exitCode, 1);
    assert.deepEqual(errors, [
      `TestFlight upload refused: ${BUILD_NUMBER_TAKEN}`,
    ]);
    for (const line of [...errors, ...logs])
      for (const secret of secrets) assert.ok(!line.includes(secret));
  } finally {
    console.error = originalError;
    console.log = originalLog;
    process.exitCode = undefined;
    await rm(dir, { recursive: true, force: true });
  }
});

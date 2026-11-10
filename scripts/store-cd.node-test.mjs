import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appleQueueBlock,
  dispatch,
  nextVersion,
  previousSubmission,
  previousPlaySubmission,
  newestProductionRelease,
  releaseTarget,
  recordFailure,
  storeInfrastructureReasons,
} from "./store-cd.mjs";
import { verifyArchive } from "./download-mobile-build.mjs";
import { androidVersionCode } from "./publish-google-play.mjs";

const source = "a".repeat(40);
const status = {
  liveVersion: "1.0.12",
  live: [{ versionCodes: ["100738"] }],
  review: {
    available: true,
    releases: [
      {
        track: "production",
        state: "RELEASE_LIFECYCLE_STATE_PUBLISHED",
        versionCodes: ["100738"],
      },
      {
        track: "internal",
        state: "RELEASE_LIFECYCLE_STATE_DRAFT",
        versionCodes: [],
      },
    ],
  },
};
function fixture(target = "google-play") {
  const records = [],
    calls = [];
  const services = {
    lines: async () => {},
    status: async () =>
      structuredClone(
        target === "google-play"
          ? status
          : {
              liveVersion: "1.0.12",
              versions: [{ version: "1.0.12", state: "READY_FOR_SALE" }],
            },
      ),
    commit: async () => ({ version: "1.0.12" }),
    previous: async () => false,
    previousPlay: async () => false,
    versionCode: (build) => androidVersionCode(build, "100000"),
    dispatch: async (workflow, inputs) => {
      calls.push({ workflow, inputs });
      return calls.length;
    },
    qualify: async () => ({ source, version: "1.0.13", build: 739 }),
    result: async () => "submitted",
  };
  const save = async (record) => records.push(record);
  return {
    services,
    calls,
    records,
    run: () => releaseTarget({ target, source, runId: 7, save, services }),
  };
}
function unobservableFixture() {
  const fixtureValue = fixture();
  fixtureValue.services.status = async () => ({
    ...status,
    review: { available: false, httpStatus: 403, reason: "permission-denied" },
    tracks: [
      {
        track: "production",
        releases: [
          {
            name: "TaskNotes 1.0.13",
            status: "completed",
            versionCodes: ["100739"],
          },
        ],
      },
    ],
  });
  fixtureValue.services.previousPlay = async (...args) => {
    assert.equal(args.length, 1);
    if (args[0].name !== "TaskNotes 1.0.13" || args[0].versionCode !== 100739)
      return false;
    return {
      source,
      outcome: "submitted",
      source_run_id: 42,
      version: "1.0.13",
      build: 739,
    };
  };
  fixtureValue.services.qualify = async (...args) => {
    assert.deepEqual(args, ["android", 42]);
    return { source, version: "1.0.13", build: 739 };
  };
  return fixtureValue;
}

async function attempt(fixtureValue) {
  const receipt = { target: "google-play", write_started: false };
  const holds = [];
  try {
    await fixtureValue.run();
    for (const record of fixtureValue.records) Object.assign(receipt, record);
  } catch (error) {
    for (const record of fixtureValue.records) Object.assign(receipt, record);
    await recordFailure(
      receipt,
      error,
      async (record) => Object.assign(receipt, record),
      async (...args) => holds.push(args),
    );
  }
  return { receipt, holds };
}

test("unavailable Play lifecycle with the exact submitted source build quietly waits without writes or stops", async () => {
  const fixtureValue = unobservableFixture();
  const { receipt, holds } = await attempt(fixtureValue);
  assert.equal(receipt.outcome, "pending-review-unobservable");
  assert.equal(receipt.write_started, false);
  assert.equal(receipt.source_run_id, 42);
  assert.equal(receipt.build, 739);
  assert.deepEqual(fixtureValue.calls, []);
  assert.deepEqual(holds, []);
});

test("unavailable Play lifecycle retains a retryable refusal when production does not prove the exact build", async () => {
  for (const change of [
    { versionCodes: ["100738"] },
    { versionCodes: ["1007390"] },
    { versionCodes: [100739] },
    { name: "TaskNotes 1.0.12" },
    { status: "draft" },
    { track: "internal" },
    { tracks: [] },
  ]) {
    const fixtureValue = unobservableFixture();
    const original = fixtureValue.services.status;
    fixtureValue.services.status = async () => {
      const value = await original();
      Object.assign(value.tracks[0].releases[0], change);
      if (change.track) value.tracks[0].track = change.track;
      if (change.tracks) value.tracks = change.tracks;
      return value;
    };
    const { receipt, holds } = await attempt(fixtureValue);
    assert.equal(receipt.outcome, "stopped");
    assert.equal(receipt.reason, "play-release-lifecycle-observer-unavailable");
    assert.equal(receipt.write_started, false);
    assert.deepEqual(fixtureValue.calls, []);
    assert.deepEqual(holds, []);
  }
});

test("unobservable review cannot borrow a missing receipt or changed/untrusted signed build", async () => {
  for (const change of [
    { previousPlay: async () => false },
    {
      qualify: async () => ({
        source: "b".repeat(40),
        version: "1.0.13",
        build: 739,
      }),
    },
    { qualify: async () => ({ source, version: "1.0.14", build: 739 }) },
    { qualify: async () => ({ source, version: "1.0.13", build: 740 }) },
    {
      qualify: async () => {
        throw new Error("signed-artifact-digest-required");
      },
    },
    { versionCode: (build) => androidVersionCode(build, null) },
  ]) {
    const fixtureValue = unobservableFixture();
    Object.assign(fixtureValue.services, change);
    const { receipt, holds } = await attempt(fixtureValue);
    assert.equal(receipt.outcome, "stopped");
    assert.equal(receipt.write_started, false);
    if (change.previousPlay) {
      assert.equal(
        receipt.reason,
        "play-release-lifecycle-observer-unavailable",
      );
      assert.deepEqual(holds, []);
    } else {
      assert.equal(holds.length, 1);
    }
    assert.deepEqual(fixtureValue.calls, []);
  }
});

test("a newer source waits for our prior submission before qualifying or building the new source", async () => {
  const fixtureValue = unobservableFixture();
  const previousSource = "b".repeat(40);
  const previous = fixtureValue.services.previousPlay;
  fixtureValue.services.previousPlay = async (...args) => ({
    ...(await previous(...args)),
    source: previousSource,
  });
  fixtureValue.services.qualify = async () => ({
    source: previousSource,
    version: "1.0.13",
    build: 739,
  });
  fixtureValue.services.commit = async () =>
    assert.fail("must not qualify the new source");
  const { receipt, holds } = await attempt(fixtureValue);
  assert.equal(receipt.outcome, "pending-review-unobservable");
  assert.equal(receipt.pending_source, previousSource);
  assert.equal(receipt.write_started, false);
  assert.deepEqual(fixtureValue.calls, []);
  assert.deepEqual(holds, []);

  fixtureValue.services.status = async () => ({
    ...structuredClone(status),
    liveVersion: "1.0.13",
  });
  fixtureValue.services.commit = async () => ({ version: "1.0.12" });
  fixtureValue.services.qualify = async () => ({
    source,
    version: "1.0.14",
    build: 740,
  });
  await fixtureValue.run();
  assert.deepEqual(
    fixtureValue.calls.map((call) => call.workflow),
    ["android.yml", "google-play-production.yml"],
  );
  assert.equal(fixtureValue.records.at(-1).outcome, "submitted");
  assert.equal(fixtureValue.calls[0].inputs.version, "1.0.14");
});

test("newest production identity uses versionCode, not track order or an older owned release", async () => {
  for (const reverse of [false, true]) {
    const fixtureValue = unobservableFixture();
    const readStatus = fixtureValue.services.status;
    fixtureValue.services.status = async () => {
      const value = await readStatus();
      value.tracks[0].releases.push({
        name: "Other 2.0.0",
        status: "completed",
        versionCodes: ["100740"],
      });
      if (reverse) value.tracks[0].releases.reverse();
      return value;
    };
    fixtureValue.services.previousPlay = async (release) => {
      assert.deepEqual(release, { name: "Other 2.0.0", versionCode: 100740 });
      return false;
    };
    const { receipt, holds } = await attempt(fixtureValue);
    assert.equal(receipt.reason, "play-release-lifecycle-observer-unavailable");
    assert.equal(receipt.write_started, false);
    assert.deepEqual(fixtureValue.calls, []);
    assert.deepEqual(holds, []);
  }
});

test("ambiguous or malformed production snapshots cannot prove a prior submission", () => {
  const release = {
    name: "TaskNotes 1.0.13",
    status: "completed",
    versionCodes: ["100739"],
  };
  assert.equal(newestProductionRelease(null), null);
  assert.equal(newestProductionRelease({}), null);
  assert.equal(newestProductionRelease([null]), null);
  assert.equal(
    newestProductionRelease([{ track: "production", releases: [null] }]),
    null,
  );
  for (const reverse of [false, true]) {
    const releases = [
      { ...release, name: "Other 1.0.12", versionCodes: ["100738"] },
      release,
    ];
    if (reverse) releases.reverse();
    assert.deepEqual(
      newestProductionRelease([{ track: "production", releases }]),
      {
        name: "TaskNotes 1.0.13",
        versionCode: 100739,
      },
    );
  }
  for (const releases of [
    [],
    [release, release],
    [{ ...release, versionCodes: [] }],
    [{ ...release, versionCodes: ["bad"] }],
    [{ ...release, versionCodes: ["9007199254740992"] }],
    [{ ...release, status: "inProgress" }],
    [release, { ...release, versionCodes: undefined }],
  ]) {
    assert.equal(
      newestProductionRelease([{ track: "production", releases }]),
      null,
    );
  }
  assert.equal(
    newestProductionRelease([
      { track: "production", releases: [release] },
      { track: "production", releases: [release] },
    ]),
    null,
  );
});

test("prior-source lookup requires a retained successful same-target exact build and release receipt", async () => {
  const run = {
    id: 7,
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
    path: ".github/workflows/publish-tasknotes-store.yml",
    head_branch: "main",
    event: "workflow_dispatch",
  };
  const receipt = {
    schema: "tasknotes/store-cd/1",
    run_id: 7,
    target: "google-play",
    source: "b".repeat(40),
    outcome: "submitted",
    source_run_id: 42,
    version: "1.0.13",
    build: 739,
  };
  for (const [runChange, receiptChange, artifactChange] of [
    [{}, {}, {}],
    [{ conclusion: "failure" }, {}, {}],
    [{ run_attempt: 2 }, {}, {}],
    [{ path: ".github/workflows/android.yml" }, {}, {}],
    [{ head_branch: "other" }, {}, {}],
    [{ event: "push" }, {}, {}],
    [{ status: "in_progress" }, {}, {}],
    [{}, { target: "app-store" }, {}],
    [{}, { run_id: 8 }, {}],
    [{}, { schema: "old" }, {}],
    [{}, { source: "invalid" }, {}],
    [{}, { source_run_id: null }, {}],
    [{}, { build: null }, {}],
    [{}, { build: 740 }, {}],
    [{}, { version: "1.0.14" }, {}],
    [{}, { outcome: "pending-review-unobservable" }, {}],
    [{}, { outcome: "already-live" }, {}],
    [{}, {}, { expired: true }],
    [{}, {}, { name: "other" }],
  ]) {
    const found = await previousPlaySubmission(
      { name: "TaskNotes 1.0.13", versionCode: 100739 },
      (path) =>
        path.includes("/artifacts?")
          ? {
              artifacts: [
                {
                  name: "tasknotes-store-google-play-7",
                  expired: false,
                  ...artifactChange,
                },
              ],
            }
          : [{ workflow_runs: [{ ...run, ...runChange }] }],
      async () => ({ ...receipt, ...receiptChange }),
      (build) => androidVersionCode(build, "100000"),
    );
    assert.equal(
      Boolean(found),
      !Object.keys(runChange).length &&
        !Object.keys(receiptChange).length &&
        !Object.keys(artifactChange).length,
    );
  }
  const found = await previousPlaySubmission(
    { name: "TaskNotes 1.0.13", versionCode: 100739 },
    (path) =>
      path.includes("/artifacts?")
        ? {
            artifacts: [
              {
                name: `tasknotes-store-google-play-${path.split("/")[5]}`,
                expired: false,
              },
            ],
          }
        : [{ workflow_runs: [{ ...run, id: 8 }] }, { workflow_runs: [run] }],
    async (runId) =>
      runId === 8 ? { ...receipt, run_id: 8, build: 740 } : receipt,
    (build) => androidVersionCode(build, "100000"),
  );
  assert.equal(found.source, receipt.source);
});

test("Play lifecycle preserves outcomes while only rejection self-stops before writes", async () => {
  for (const [review, expected, reason] of [
    [status.review, "submitted"],
    [
      {
        available: true,
        releases: [{ state: "RELEASE_LIFECYCLE_STATE_IN_REVIEW" }],
      },
      "pending-review",
    ],
    [
      {
        available: true,
        releases: [{ state: "RELEASE_LIFECYCLE_STATE_NOT_APPROVED" }],
      },
      "stopped",
      "store-rejected",
    ],
    [
      { available: true, releases: [] },
      "stopped",
      "play-release-lifecycle-observer-unavailable",
    ],
  ]) {
    const fixtureValue = fixture();
    fixtureValue.services.status = async () => ({ ...status, review });
    const { receipt, holds } = await attempt(fixtureValue);
    assert.equal(receipt.outcome, expected);
    assert.equal(receipt.reason, reason);
    assert.deepEqual(
      holds,
      reason === "store-rejected"
        ? [["android", "stop", "store-rejected"]]
        : [],
    );
    assert.equal(fixtureValue.calls.length, expected === "submitted" ? 2 : 0);
  }
});

test("same-source submission lookup binds the retained receipt and successful first-attempt run", async () => {
  const run = {
    id: 7,
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
    path: ".github/workflows/publish-tasknotes-store.yml",
    head_branch: "main",
    event: "workflow_dispatch",
  };
  const receipt = {
    schema: "tasknotes/store-cd/1",
    run_id: 7,
    target: "google-play",
    source,
    outcome: "submitted",
    source_run_id: 42,
    version: "1.0.13",
    build: 739,
  };
  for (const [runChange, receiptChange, expired] of [
    [{}, {}, false],
    [{ conclusion: "failure" }, {}, false],
    [{ run_attempt: 2 }, {}, false],
    [{}, { source: "b".repeat(40) }, false],
    [{}, { target: "app-store" }, false],
    [{}, { run_id: 8 }, false],
    [{}, { schema: "old" }, false],
    [{}, { outcome: "pending-review-unobservable" }, false],
    [{}, { outcome: "already-live" }, false],
    [{}, { source_run_id: null }, false],
    [{}, { build: null }, false],
    [{}, {}, true],
  ]) {
    const expected =
      !Object.keys(runChange).length &&
      !Object.keys(receiptChange).length &&
      !expired;
    const found = await previousSubmission(
      "google-play",
      source,
      undefined,
      (path) =>
        path.includes("/artifacts?")
          ? { artifacts: [{ name: "tasknotes-store-google-play-7", expired }] }
          : [{ workflow_runs: [{ ...run, ...runChange }] }],
      async () => ({ ...receipt, ...receiptChange }),
    );
    assert.equal(Boolean(found), expected);
  }
});

test("publisher and observer calculate the same exact Android versionCode", () => {
  assert.equal(androidVersionCode(739, "100000"), 100739);
  for (const [build, base] of [
    [739, ""],
    [739, "bad"],
    [739, "-1"],
    [0, "100000"],
    [1.5, "100000"],
    [739, "2100000000"],
  ])
    assert.throws(() => androidVersionCode(build, base));
});
test("both production targets build exact green main and submit automatically", async () => {
  for (const [target, build, publisher] of [
    ["google-play", "android.yml", "google-play-production.yml"],
    ["app-store", "ios-release.yml", "app-store-submit.yml"],
  ]) {
    const fixtureValue = fixture(target);
    await fixtureValue.run();
    assert.deepEqual(fixtureValue.calls, [
      { workflow: build, inputs: { source_sha: source, version: "1.0.13" } },
      { workflow: publisher, inputs: { source_run_id: "1" } },
    ]);
    assert.equal(fixtureValue.records.at(-1).outcome, "submitted");
  }
});
test("store versions increase without a separate package-version or cooldown gate", () => {
  assert.equal(nextVersion("1.0.12", "1.0.12"), "1.0.13");
  assert.equal(nextVersion("1.1.0", "1.0.12"), "1.1.0");
  assert.equal(nextVersion("1.0.12", "1.2.99"), "1.2.100");
  assert.throws(() => nextVersion("bad", "1.0.12"));
});
test("pending or processing stores quietly wait without building, even an older source", async () => {
  for (const state of [
    "WAITING_FOR_REVIEW",
    "IN_REVIEW",
    "PENDING_APPLE_RELEASE",
    "PENDING_DEVELOPER_RELEASE",
    "PROCESSING_FOR_APP_STORE",
    "PREPARE_FOR_SUBMISSION",
    "FUTURE_UNKNOWN_STATE",
  ]) {
    const fixtureValue = fixture("app-store");
    fixtureValue.services.status = async () => ({ versions: [{ state }] });
    fixtureValue.services.commit = async () => {
      throw new Error("must-not-check-while-pending");
    };
    await fixtureValue.run();
    assert.equal(fixtureValue.records.at(-1).outcome, "pending-review");
    assert.equal(fixtureValue.calls.length, 0);
  }
  const fixtureValue = fixture();
  fixtureValue.services.status = async () => ({
    ...status,
    review: {
      available: true,
      releases: [
        { state: "RELEASE_LIFECYCLE_STATE_IN_REVIEW", versionCodes: ["123"] },
      ],
    },
  });
  await fixtureValue.run();
  assert.equal(fixtureValue.records.at(-1).outcome, "pending-review");
  assert.equal(fixtureValue.calls.length, 0);
});
test("rejections, stopped lines, failed checks and mismatched builds fail closed", async () => {
  assert.equal(appleQueueBlock([{ state: "REJECTED" }]), "store-rejected");
  for (const change of [
    {
      lines: async () => {
        throw new Error("store-line-stopped");
      },
    },
    {
      commit: async () => {
        throw new Error("exact-main-ci-required");
      },
    },
    {
      status: async () => ({
        ...status,
        review: {
          available: true,
          releases: [{ state: "RELEASE_LIFECYCLE_STATE_NOT_APPROVED" }],
        },
      }),
    },
    { qualify: async () => ({ source: "b".repeat(40), version: "1.0.13" }) },
    { result: async () => "unknown" },
  ]) {
    const fixtureValue = fixture();
    Object.assign(fixtureValue.services, change);
    await assert.rejects(fixtureValue.run());
    assert.ok(
      fixtureValue.calls.length <= (change.result ? 2 : change.qualify ? 1 : 0),
    );
  }
});
test("a review raced at the final publisher remains pending, not submitted", async () => {
  for (const outcome of ["pending-review", "pending-review-unobservable"]) {
    const fixtureValue = fixture();
    fixtureValue.services.result = async () => outcome;
    await fixtureValue.run();
    assert.equal(fixtureValue.records.at(-1).outcome, outcome);
  }
});
test("a submitted same-source receipt prevents a second build after approval", async () => {
  const fixtureValue = fixture();
  fixtureValue.services.previous = async () => true;
  await fixtureValue.run();
  assert.equal(fixtureValue.records.at(-1).outcome, "already-live");
  assert.equal(fixtureValue.calls.length, 0);
});
test("a parent-line stop after a qualified Android build holds before store submission", async () => {
  for (const target of ["google-play", "app-store"]) {
    const fixtureValue = fixture(target);
    let lineReads = 0;
    fixtureValue.services.lines = async () => {
      if (++lineReads === 2) throw new Error("app-line-stopped");
    };
    const dispatchBuild = fixtureValue.services.dispatch;
    fixtureValue.services.dispatch = async (workflow, inputs, save) => {
      await save({
        boundary: workflow,
        boundary_outcome: "success",
        write_started: true,
      });
      return dispatchBuild(workflow, inputs);
    };
    const receipt = { target, write_started: false };
    const holds = [];
    await assert.rejects(fixtureValue.run(), /app-line-stopped/);
    for (const record of fixtureValue.records) Object.assign(receipt, record);
    await recordFailure(
      receipt,
      new Error("app-line-stopped"),
      async (record) => Object.assign(receipt, record),
      async (...args) => holds.push(args),
    );
    assert.equal(receipt.write_started, target !== "google-play");
    assert.equal(receipt.boundary_outcome, "success");
    assert.equal(fixtureValue.calls.length, 1);
    assert.deepEqual(
      holds,
      target === "google-play"
        ? []
        : [["ios", "stop", "app-publication-failed"]],
    );
  }
});
test("parent-line holds require a known pre-store-write boundary", async () => {
  for (const [target, boundary, boundaryOutcome, writeStarted, quiet] of [
    ["google-play", undefined, undefined, false, true],
    ["google-play", "store-status.yml", "success", false, true],
    ["google-play", "android.yml", "success", false, true],
    ["google-play", "android.yml", "waiting", false, false],
    ["google-play", "android.yml", "dispatch-unknown", false, false],
    ["google-play", "android.yml", "failed", false, false],
    ["google-play", "android.yml", "success", true, false],
    ["app-store", "android.yml", "success", false, false],
    ["app-store", "ios-release.yml", "success", false, false],
    ["google-play", "google-play-production.yml", "success", false, false],
  ]) {
    const receipt = {
      target,
      boundary,
      boundary_outcome: boundaryOutcome,
      write_started: writeStarted,
    };
    const holds = [];
    await recordFailure(
      receipt,
      new Error("app-line-stopped"),
      async (record) => Object.assign(receipt, record),
      async (...args) => holds.push(args),
    );
    assert.equal(holds.length, quiet ? 0 : 1);
  }
});
test("Android store submission still persists write evidence before dispatch", async () => {
  const fixtureValue = fixture();
  fixtureValue.services.dispatch = async (workflow, inputs, save) => {
    const receipt = Object.assign({}, ...fixtureValue.records);
    if (workflow === "google-play-production.yml") {
      assert.equal(receipt.write_started, false);
      await assert.rejects(
        dispatch(workflow, inputs, save, () => {
          assert.equal(
            Object.assign({}, ...fixtureValue.records).write_started,
            true,
          );
          throw new Error("unavailable");
        }),
      );
      throw new Error("store-outcome-unknown");
    }
    await save({
      boundary: workflow,
      boundary_outcome: "success",
      write_started: true,
    });
    return 1;
  };
  const { receipt, holds } = await attempt(fixtureValue);
  assert.equal(receipt.write_started, true);
  assert.equal(receipt.reason, "store-outcome-unknown");
  assert.deepEqual(holds, [["android", "stop", "app-outcome-unknown"]]);
});
test("unknown dispatches and changed run bindings are never retried", async () => {
  for (const response of [{}, { workflow_run_id: 1 }]) {
    const calls = [],
      records = [];
    const transport = (path) => {
      calls.push(path);
      return path.endsWith("/dispatches") ? response : { id: 1, path: "wrong" };
    };
    await assert.rejects(
      dispatch(
        "android.yml",
        { source_sha: source },
        async (record) => records.push(record),
        transport,
      ),
    );
    assert.equal(
      calls.filter((path) => path.endsWith("/dispatches")).length,
      1,
    );
    assert.equal(records[0].boundary_outcome, "dispatch-unknown");
  }
});
test("archive bytes must match the qualified Actions artifact digest", () => {
  const bytes = Buffer.from("signed archive fixture");
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  assert.doesNotThrow(() => verifyArchive(bytes, digest));
  assert.throws(
    () => verifyArchive(Buffer.from("changed"), digest),
    /digest-mismatch/,
  );
  assert.throws(() => verifyArchive(bytes, undefined), /digest-mismatch/);
});

test("target qualification receives only that platform before any write", async () => {
  for (const [target, platform] of [
    ["google-play", "android"],
    ["app-store", "ios"],
  ]) {
    const fixtureValue = fixture(target);
    fixtureValue.services.commit = async (...args) => {
      assert.deepEqual(args, [source, platform]);
      assert.equal(fixtureValue.calls.length, 0);
      throw new Error("exact-main-ci-required");
    };
    await assert.rejects(fixtureValue.run(), /exact-main-ci-required/);
    assert.ok(!fixtureValue.records.some((record) => record.write_started));
  }
});

test("an evidenced pre-write check refusal avoids the TaskNotes stop writer", async () => {
  for (const target of ["google-play", "app-store"]) {
    for (const boundary of [
      {},
      { boundary: "store-status.yml", boundary_outcome: "success" },
    ]) {
      const receipt = { target, write_started: false, ...boundary };
      const holds = [];
      await recordFailure(
        receipt,
        new Error("exact-main-ci-required"),
        async (record) => Object.assign(receipt, record),
        async (...args) => holds.push(args),
      );
      assert.equal(receipt.outcome, "stopped");
      assert.equal(receipt.write_started, false);
      assert.deepEqual(holds, []);
    }
  }
  for (const [changed, reason, expected] of [
    [
      { write_started: undefined },
      "exact-main-ci-required",
      "app-outcome-unknown",
    ],
    [{ write_started: true }, "exact-main-ci-required", "app-outcome-unknown"],
    [
      { boundary: "android.yml" },
      "exact-main-ci-required",
      "app-outcome-unknown",
    ],
    [
      { boundary: "store-status.yml", boundary_outcome: "waiting" },
      "exact-main-ci-required",
      "app-outcome-unknown",
    ],
    [
      { write_started: true, boundary_outcome: "failed" },
      "store-build-or-publication-failed",
      "app-publication-failed",
    ],
    [{}, "store-artifact-digest-mismatch", "app-publication-failed"],
    [{}, "signed-artifact-digest-required", "app-publication-failed"],
    [{}, "store-rejected", "store-rejected"],
    [{ write_started: true }, "store-outcome-unknown", "app-outcome-unknown"],
    [
      { write_started: true, boundary_outcome: "dispatch-unknown" },
      "release-evidence-unavailable",
      "app-outcome-unknown",
    ],
  ]) {
    const receipt = { target: "google-play", write_started: false, ...changed };
    const holds = [];
    await recordFailure(
      receipt,
      new Error(reason),
      async (record) => Object.assign(receipt, record),
      async (...args) => holds.push(args),
    );
    assert.deepEqual(holds, [["android", "stop", expected]]);
  }
});

test("store infrastructure reasons pin the ops bin/lib/cd_retry.py allowlist", () => {
  assert.deepEqual(storeInfrastructureReasons, [
    "release-evidence-unavailable",
    "npm-evidence-unavailable",
    "store-line-outcome-unknown",
    "store-line-read-timeout",
    "store-outcome-unknown",
    "play-release-lifecycle-observer-unavailable",
    "store-observer-unavailable",
    "store-status-observer-unavailable",
    "store-status-transport",
    "store-status-transport-failed",
    "store-status-transport-unavailable",
    "store-status-timeout",
    "store-status-observer-timeout",
  ]);
});

test("retryable pre-write failures retain target, source and run without dispatching a hold", async () => {
  for (const target of ["google-play", "app-store"]) {
    for (const reason of storeInfrastructureReasons.filter(
      (reason) => !reason.includes("outcome-unknown"),
    )) {
      for (const boundary of [
        {},
        { boundary: "store-status.yml", boundary_outcome: "success" },
        { boundary: "store-status.yml", boundary_outcome: "failed" },
        { boundary: "store-status.yml", boundary_outcome: "waiting" },
        { boundary: "store-status.yml", boundary_outcome: "dispatch-unknown" },
      ]) {
        const receipt = {
          schema: "tasknotes/store-cd/1",
          target,
          source,
          run_id: 42,
          write_started: false,
          ...boundary,
        };
        const retained = [];
        const holds = [];
        await recordFailure(
          receipt,
          new Error(reason),
          async (record) => {
            Object.assign(receipt, record);
            retained.push(structuredClone(receipt));
          },
          async (...args) => holds.push(args),
        );
        assert.deepEqual(retained, [
          {
            schema: "tasknotes/store-cd/1",
            target,
            source,
            run_id: 42,
            write_started: false,
            ...boundary,
            outcome: "stopped",
            reason,
          },
        ]);
        assert.deepEqual(holds, []);
      }
    }
  }
});

test("retryable failures still hold when a write started or its state is unknown", async () => {
  for (const [target, platform] of [
    ["google-play", "android"],
    ["app-store", "ios"],
  ]) {
    for (const reason of storeInfrastructureReasons) {
      for (const writeStarted of [true, undefined, null]) {
        const receipt = { target, write_started: writeStarted };
        const holds = [];
        await recordFailure(
          receipt,
          new Error(reason),
          async (record) => Object.assign(receipt, record),
          async (...args) => holds.push(args),
        );
        assert.equal(receipt.outcome, "stopped");
        assert.equal(receipt.reason, reason);
        assert.equal(receipt.write_started, writeStarted);
        assert.deepEqual(holds, [
          [
            platform,
            "stop",
            reason === "store-outcome-unknown"
              ? "app-outcome-unknown"
              : "app-publication-failed",
          ],
        ]);
      }
    }
  }
});

test("non-retryable and rejected pre-write failures still dispatch a hold", async () => {
  for (const [target, platform] of [
    ["google-play", "android"],
    ["app-store", "ios"],
  ]) {
    for (const [reason, stopReason] of [
      ["store-rejected", "store-rejected"],
      ["signed-artifact-digest-required", "app-publication-failed"],
      ["store-evidence-unavailable", "app-outcome-unknown"],
      ["store-line-outcome-unknown", "app-publication-failed"],
      ["store-outcome-unknown", "app-outcome-unknown"],
      ["store-dispatch-identity-unknown", "app-outcome-unknown"],
    ]) {
      const receipt = { target, write_started: false };
      const holds = [];
      await recordFailure(
        receipt,
        new Error(reason),
        async (record) => Object.assign(receipt, record),
        async (...args) => holds.push(args),
      );
      assert.equal(receipt.outcome, "stopped");
      assert.equal(receipt.reason, reason);
      assert.deepEqual(holds, [[platform, "stop", stopReason]]);
    }
  }
});

test("retryable reasons never bypass an unknown or waiting write dispatch boundary", async () => {
  for (const target of ["google-play", "app-store"]) {
    for (const reason of storeInfrastructureReasons) {
      for (const boundary of [
        undefined,
        "android.yml",
        "ios-release.yml",
        "google-play-production.yml",
        "app-store-submit.yml",
      ]) {
        for (const boundaryOutcome of ["dispatch-unknown", "waiting"]) {
          const receipt = {
            target,
            write_started: false,
            boundary,
            boundary_outcome: boundaryOutcome,
          };
          const holds = [];
          await recordFailure(
            receipt,
            new Error(reason),
            async (record) => Object.assign(receipt, record),
            async (...args) => holds.push(args),
          );
          assert.deepEqual(holds, [
            [
              target === "google-play" ? "android" : "ios",
              "stop",
              "app-outcome-unknown",
            ],
          ]);
        }
      }
    }
  }
});

test("an unresolved observer still stops for unknown reasons or unproven pre-write state", async () => {
  for (const boundaryOutcome of ["waiting", "dispatch-unknown"]) {
    for (const [reason, writeStarted] of [
      ["store-outcome-unknown", false],
      ["store-line-outcome-unknown", false],
      ["store-dispatch-identity-unknown", false],
      ["store-run-binding-required", false],
      ["release-evidence-unavailable", true],
      ["release-evidence-unavailable", undefined],
      ["release-evidence-unavailable", null],
    ]) {
      const receipt = {
        target: "google-play",
        write_started: writeStarted,
        boundary: "store-status.yml",
        boundary_outcome: boundaryOutcome,
      };
      const holds = [];
      await recordFailure(
        receipt,
        new Error(reason),
        async (record) => Object.assign(receipt, record),
        async (...args) => holds.push(args),
      );
      assert.deepEqual(holds, [["android", "stop", "app-outcome-unknown"]]);
    }
  }
});

for (const boundaryOutcome of ["waiting", "dispatch-unknown"]) {
  test(`store-status ${boundaryOutcome} API failure retains the retry receipt without stopping`, async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "tasknotes-store-observer-"),
    );
    try {
      const receipt = {
        schema: "tasknotes/store-cd/1",
        target: "google-play",
        source,
        run_id: 42,
        write_started: false,
      };
      const path = join(directory, "store-cd-result.json");
      const save = async (record) => {
        Object.assign(receipt, record);
        await writeFile(path, JSON.stringify(receipt));
      };
      const holds = [];
      let failure;
      await assert.rejects(
        dispatch(
          "store-status.yml",
          { platform: "android" },
          save,
          (path) => {
            if (path.endsWith("/dispatches") && boundaryOutcome === "waiting")
              return { workflow_run_id: 8 };
            throw new Error("release-evidence-unavailable");
          },
          async () => {},
        ),
        (error) => {
          failure = error;
          return error.message === "release-evidence-unavailable";
        },
      );
      await recordFailure(receipt, failure, save, async (...args) =>
        holds.push(args),
      );
      assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
        schema: "tasknotes/store-cd/1",
        target: "google-play",
        source,
        run_id: 42,
        write_started: false,
        boundary: "store-status.yml",
        boundary_outcome: boundaryOutcome,
        child_run_id: boundaryOutcome === "waiting" ? 8 : null,
        outcome: "stopped",
        reason: "release-evidence-unavailable",
      });
      assert.deepEqual(holds, []);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("retryable CLI failure retains its result and exits nonzero without stopping the line", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tasknotes-store-cd-"));
  try {
    await writeFile(
      join(directory, "gh"),
      `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";
const request = JSON.parse(readFileSync(0, "utf8"));
appendFileSync(process.env.STORE_CD_TEST_CALLS, request.inputs.operation + "\\n");
process.exitCode = 1;
`,
      { mode: 0o755 },
    );
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./store-cd.mjs", import.meta.url))],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          PATH: `${directory}:${process.env.PATH}`,
          APP_EVIDENCE_GH_TOKEN: "test",
          GITHUB_REPOSITORY: "callumalpass/tasknotes-app",
          GITHUB_REF: "refs/heads/main",
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_RUN_ID: "42",
          GITHUB_EVENT_NAME: "workflow_dispatch",
          GITHUB_WORKFLOW_REF:
            "callumalpass/tasknotes-app/.github/workflows/publish-tasknotes-store.yml@refs/heads/main",
          STORE_TARGET: "app-store",
          SOURCE_SHA: source,
          STORE_CD_TEST_CALLS: join(directory, "calls"),
        },
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "Store CD refused; inspect the bounded outcome.\n",
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(join(directory, "store-cd-result.json"), "utf8"),
      ),
      {
        schema: "tasknotes/store-cd/1",
        target: "app-store",
        source,
        run_id: 42,
        outcome: "stopped",
        write_started: false,
        reason: "release-evidence-unavailable",
      },
    );
    assert.equal(await readFile(join(directory, "calls"), "utf8"), "status\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("write evidence precedes build dispatch and is never reset by later status reads", async () => {
  for (const workflow of [
    "android.yml",
    "ios-release.yml",
    "google-play-production.yml",
    "app-store-submit.yml",
  ]) {
    const receipt = { write_started: false };
    const save = async (record) => Object.assign(receipt, record);
    await assert.rejects(
      dispatch(workflow, {}, save, () => {
        assert.equal(receipt.write_started, true);
        assert.equal(receipt.boundary_outcome, "dispatch-unknown");
        throw new Error("unavailable");
      }),
    );
    await assert.rejects(
      dispatch("store-status.yml", {}, save, () => {
        assert.equal(receipt.write_started, true);
        throw new Error("unavailable");
      }),
    );
  }
  const receipt = { write_started: false };
  await dispatch(
    "store-status.yml",
    {},
    async (record) => Object.assign(receipt, record),
    (path) =>
      path.endsWith("/dispatches")
        ? { workflow_run_id: 8 }
        : {
            id: 8,
            path: ".github/workflows/store-status.yml",
            head_branch: "main",
            event: "workflow_dispatch",
            run_attempt: 1,
            status: "completed",
            conclusion: "success",
          },
  );
  assert.equal(receipt.write_started, false);
  assert.equal(receipt.boundary_outcome, "success");
});

test("completed build failure is known failure, not an unknown write", async () => {
  const records = [];
  await assert.rejects(
    dispatch(
      "android.yml",
      {},
      async (record) => records.push(record),
      (path) =>
        path.endsWith("/dispatches")
          ? { workflow_run_id: 9 }
          : {
              id: 9,
              path: ".github/workflows/android.yml",
              head_branch: "main",
              event: "workflow_dispatch",
              run_attempt: 1,
              status: "completed",
              conclusion: "failure",
            },
    ),
    /store-build-or-publication-failed/,
  );
  assert.equal(records[0].write_started, true);
  assert.equal(records.at(-1).boundary_outcome, "failed");
});

const completedChild = {
  id: 9,
  path: ".github/workflows/android.yml",
  head_branch: "main",
  event: "workflow_dispatch",
  run_attempt: 1,
  status: "completed",
  conclusion: "success",
};

test("child reads recover from transient failures and reset the consecutive counter", async () => {
  const records = [],
    waits = [];
  let dispatches = 0,
    reads = 0;
  const runId = await dispatch(
    "android.yml",
    {},
    async (record) => records.push(record),
    (path) => {
      if (path.endsWith("/dispatches")) {
        dispatches++;
        return { workflow_run_id: 9 };
      }
      reads++;
      if (reads === 8) return { ...completedChild, status: "in_progress" };
      if (reads === 16) return completedChild;
      throw new Error("release-evidence-unavailable");
    },
    async (delay) => waits.push(delay),
  );
  assert.equal(runId, 9);
  assert.equal(dispatches, 1);
  assert.equal(reads, 16);
  assert.deepEqual(waits, Array(15).fill(15000));
  assert.equal(records.at(-1).boundary_outcome, "success");
});

test("eight consecutive failed child reads give up without redispatch", async () => {
  const receipt = {},
    waits = [];
  let dispatches = 0,
    reads = 0;
  await assert.rejects(
    dispatch(
      "android.yml",
      {},
      async (record) => Object.assign(receipt, record),
      (path) => {
        if (path.endsWith("/dispatches")) {
          dispatches++;
          return { workflow_run_id: 9 };
        }
        reads++;
        throw new Error("release-evidence-unavailable");
      },
      async (delay) => waits.push(delay),
    ),
    /^Error: release-evidence-unavailable$/,
  );
  assert.equal(dispatches, 1);
  assert.equal(reads, 8);
  assert.deepEqual(waits, Array(7).fill(15000));
  assert.equal(receipt.child_run_id, 9);
  assert.equal(receipt.boundary_outcome, "waiting");
  assert.equal(receipt.write_started, true);
});

test("a successful child read with the wrong binding fails immediately after a read failure", async () => {
  let reads = 0;
  await assert.rejects(
    dispatch(
      "android.yml",
      {},
      async () => {},
      (path) => {
        if (path.endsWith("/dispatches")) return { workflow_run_id: 9 };
        if (++reads === 1) throw new Error("release-evidence-unavailable");
        return { ...completedChild, head_branch: "other" };
      },
      async () => {},
    ),
    /store-run-binding-required/,
  );
  assert.equal(reads, 2);
});

test("build refusal prints only the fixed policy reason", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./store-cd.mjs", import.meta.url)),
      "build",
      "android",
    ],
    { encoding: "utf8", env: { PATH: process.env.PATH } },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "Store CD refused: protected-store-context-required\n",
  );
});

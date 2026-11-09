import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appleQueueBlock,
  dispatch,
  nextVersion,
  previousSubmission,
  releaseTarget,
  recordFailure,
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
  fixtureValue.services.previous = async (...args) => {
    assert.deepEqual(args, ["google-play", source]);
    return {
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

test("unavailable Play lifecycle still stops when the production track does not prove the exact build", async () => {
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
    assert.deepEqual(holds, [["android", "stop", "app-publication-failed"]]);
  }
});

test("unobservable review cannot borrow a missing receipt or changed/untrusted signed build", async () => {
  for (const change of [
    { previous: async () => false },
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
    assert.equal(holds.length, 1);
    assert.deepEqual(fixtureValue.calls, []);
  }
});

test("available Play lifecycle keeps published, pending, rejected and malformed handling unchanged", async () => {
  for (const [review, expected] of [
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
    ],
    [{ available: true, releases: [] }, "stopped"],
  ]) {
    const fixtureValue = fixture();
    fixtureValue.services.status = async () => ({ ...status, review });
    const { receipt, holds } = await attempt(fixtureValue);
    assert.equal(receipt.outcome, expected);
    assert.equal(holds.length, expected === "stopped" ? 1 : 0);
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

test("only an evidenced pre-write check refusal avoids the TaskNotes stop writer", async () => {
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

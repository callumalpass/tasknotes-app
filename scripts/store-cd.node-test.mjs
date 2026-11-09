import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appleQueueBlock,
  dispatch,
  nextVersion,
  releaseTarget,
  recordFailure,
} from "./store-cd.mjs";
import { verifyArchive } from "./download-mobile-build.mjs";

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
  const fixtureValue = fixture();
  fixtureValue.services.result = async () => "pending-review";
  await fixtureValue.run();
  assert.equal(fixtureValue.records.at(-1).outcome, "pending-review");
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

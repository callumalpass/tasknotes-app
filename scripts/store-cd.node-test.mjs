import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appleQueueBlock,
  dispatch,
  nextVersion,
  releaseTarget,
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

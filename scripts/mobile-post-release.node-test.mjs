import test from "node:test";
import assert from "node:assert/strict";
import {
  monitorOwnedRollout,
  checkMobileBoundaries,
} from "./mobile-post-release.mjs";
const hour = 3_600_000,
  now = Date.UTC(2026, 10, 7, 12);
const ownership = {
  track: "production",
  versionCode: 123,
  source: "a".repeat(40),
  sourceRunId: 456,
  alreadyPublished: false,
  promotedAt: new Date(now - 48 * hour).toISOString(),
};
function setup(fraction = 0.1) {
  const calls = [];
  const state = fraction === 1 ? "completed" : "inProgress";
  return {
    calls,
    args: {
      ownership,
      now,
      enabled: true,
      held: false,
      status: {
        live: [
          { status: state, userFraction: fraction, versionCodes: ["123"] },
        ],
        review: {
          available: true,
          releases: [
            {
              track: "production",
              state: "RELEASE_LIFECYCLE_STATE_PUBLISHED",
              versionCodes: ["123"],
            },
          ],
        },
      },
      previous: {
        schema: "tasknotes/mobile-post-release/2",
        source: ownership.source,
        sourceRunId: 456,
        versionCode: 123,
        fraction,
        stageSince: new Date(now - 24 * hour).toISOString(),
        observedAt: new Date(now - 900000).toISOString(),
      },
      healthy: async () => {},
      vitals: async () => ({ verdict: "passed" }),
      mutate: async (v) => calls.push(v),
      stop: async () => calls.push("stop"),
    },
  };
}
test("widens 10 to 50 then completes 50 after a continuous 24h each", async () => {
  for (const fraction of [0.1, 0.5]) {
    const { args, calls } = setup(fraction);
    const result = await monitorOwnedRollout(args);
    assert.equal(result.fraction, fraction === 0.1 ? 0.5 : 1);
    assert.equal(result.stageSince, new Date(now).toISOString());
    assert.deepEqual(calls, [
      fraction === 0.1
        ? { status: "inProgress", userFraction: 0.5, expectedFraction: 0.1 }
        : { status: "completed", expectedFraction: 0.5 },
    ]);
  }
});
test("disabled production, held line, interrupted custody, and dwell never widen", async () => {
  for (const change of [
    { enabled: false },
    { held: true },
    { previous: undefined },
    {
      previous: {
        ...setup().args.previous,
        observedAt: new Date(now - 2 * hour).toISOString(),
      },
    },
    { previous: { ...setup().args.previous, sourceRunId: 999 } },
    {
      previous: {
        ...setup().args.previous,
        stageSince: new Date(now - hour).toISOString(),
      },
    },
  ]) {
    const { args, calls } = setup();
    await monitorOwnedRollout({ ...args, ...change });
    assert.deepEqual(calls, []);
  }
});
test("known Vitals or infrastructure failure halts exact owned rollout and stops only its line", async () => {
  for (const failure of ["vitals", "healthy"]) {
    const { args, calls } = setup();
    if (failure === "vitals") args.vitals = async () => ({ verdict: "failed" });
    else
      args.healthy = async () => {
        throw Error("private response");
      };
    assert.equal(
      (await monitorOwnedRollout(args)).outcome,
      "halted-after-failed-check",
    );
    assert.deepEqual(calls, [{ status: "halted" }, "stop"]);
  }
});
test("unknown halt outcome still stops; no retry or completion", async () => {
  const { args, calls } = setup();
  args.healthy = async () => {
    throw Error("failed");
  };
  args.mutate = async (v) => {
    calls.push(v);
    throw Error("unknown");
  };
  await assert.rejects(monitorOwnedRollout(args));
  assert.deepEqual(calls, [{ status: "halted" }, "stop"]);
});
test("missing/small Vitals holds fraction; after 72h it halts", async () => {
  for (const verdict of ["unavailable", "insufficient"]) {
    const { args, calls } = setup();
    args.vitals = async () => ({ verdict });
    assert.equal(
      (await monitorOwnedRollout(args)).outcome,
      "held-at-current-fraction",
    );
    assert.deepEqual(calls, []);
    args.ownership = {
      ...ownership,
      promotedAt: new Date(now - 96 * hour).toISOString(),
    };
    args.previous.stageSince = new Date(now - 72 * hour).toISOString();
    assert.equal(
      (await monitorOwnedRollout(args)).outcome,
      "halted-after-failed-check",
    );
  }
});
test("review/rejection is observed; a missing observer never widens", async () => {
  const { args, calls } = setup();
  args.status.review.available = false;
  assert.equal(
    (await monitorOwnedRollout(args)).outcome,
    "waiting-review-observation",
  );
  assert.deepEqual(calls, []);
  args.status.review.available = true;
  args.status.review.releases[0].state = "RELEASE_LIFECYCLE_STATE_NOT_APPROVED";
  assert.equal((await monitorOwnedRollout(args)).reason, "store-rejected");
  assert.deepEqual(calls, [{ status: "halted" }, "stop"]);
});
test("unowned, externally altered, and halted releases never resume", async () => {
  for (const change of [
    { ownership: {} },
    {
      status: {
        live: [
          { versionCodes: ["999"], status: "inProgress", userFraction: 0.1 },
        ],
      },
    },
    {
      status: {
        live: [
          { versionCodes: ["123"], status: "inProgress", userFraction: 0.2 },
        ],
      },
    },
  ]) {
    const { args, calls } = setup();
    await assert.rejects(monitorOwnedRollout({ ...args, ...change }));
    assert.deepEqual(calls, []);
  }
  const { args, calls } = setup();
  args.status.live[0].status = "halted";
  assert.equal((await monitorOwnedRollout(args)).outcome, "already-halted");
  assert.deepEqual(calls, ["stop"]);
});
test("completed version stays monitored; failure holds future publications, never downgrades", async () => {
  const { args, calls } = setup(1);
  assert.equal(
    (await monitorOwnedRollout(args)).outcome,
    "completed-release-monitored",
  );
  args.healthy = async () => {
    throw Error("failed");
  };
  assert.equal(
    (await monitorOwnedRollout(args)).outcome,
    "completed-release-line-stopped",
  );
  assert.deepEqual(calls, ["stop"]);
});
test("readiness checks are strict", async () => {
  await assert.rejects(
    checkMobileBoundaries(async () => Response.json({ ok: false })),
    /health-failed/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  haltOwnedRollout,
  checkMobileBoundaries,
} from "./mobile-post-release.mjs";

const status = { live: [{ status: "inProgress", versionCodes: ["123"] }] };
const ownership = {
  source: "a".repeat(40),
  sourceRunId: 1,
  versionCode: 123,
  track: "production",
};
test("failed checks halt exact owned staged version then stop only its line", async () => {
  const calls = [];
  const outcome = await haltOwnedRollout({
    status,
    ownership,
    healthy: async () => {
      throw new Error("unhealthy");
    },
    halt: async (v) => calls.push(["halt", v]),
    stop: async () => calls.push(["stop"]),
  });
  assert.equal(outcome, "halted-after-failed-check");
  assert.deepEqual(calls, [["halt", "123"], ["stop"]]);
});
test("unknown halt still writes a hold, never completes or retries", async () => {
  let stopped = false;
  await assert.rejects(
    haltOwnedRollout({
      status,
      ownership,
      healthy: async () => {
        throw new Error("unhealthy");
      },
      halt: async () => {
        throw new Error("unknown");
      },
      stop: async () => {
        stopped = true;
      },
    }),
    /unknown/,
  );
  assert.equal(stopped, true);
});
test("healthy staging is not silently completed; unowned version is never changed", async () => {
  let changed = false;
  const args = {
    status,
    ownership,
    healthy: async () => {},
    halt: async () => {
      changed = true;
    },
    stop: async () => {},
  };
  assert.equal(
    await haltOwnedRollout(args),
    "staged-boundaries-healthy-not-completed",
  );
  await assert.rejects(
    haltOwnedRollout({ ...args, ownership: {} }),
    /owned-rollout/,
  );
  assert.equal(changed, false);
});
test("readiness failure is a failed post-release check", async () => {
  await assert.rejects(
    checkMobileBoundaries(async () => Response.json({ ok: false })),
    /health-failed/,
  );
});

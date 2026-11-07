import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeFixture,
  runNativeJourney,
} from "./run-android-wasm-journey.mjs";

const fixture = {
  email: "registered@example.invalid",
  password: "not-a-real-credential",
  runId: "agent-unit-test",
  collectionName: "[test] agent-unit-test",
};
const health = async () => ({
  ok: true,
  json: async () => ({
    environment: "production",
    public_origin: "https://connect.mdbase.dev",
    revision: "source",
  }),
});
const success = {
  checks: {
    "runtime-initialized": true,
    "sqlite-open-query-write-reopen": true,
    "task-create-edit-reload": true,
  },
  cleanup: "owned-task-deleted-and-installation-access-revoked",
};

test("requires an exact run-scoped fixture, not just a test prefix", () => {
  assert.deepEqual(nativeFixture(JSON.stringify(fixture)), fixture);
  for (const collectionName of ["[test] another-run", "customer", null])
    assert.throws(() =>
      nativeFixture(JSON.stringify({ ...fixture, collectionName })),
    );
});

test("rejects another environment before any journey or login", async () => {
  const result = await runNativeJourney({
    account: JSON.stringify(fixture),
    health: async () => ({
      ok: true,
      json: async () => ({ environment: "lab" }),
    }),
    journey: () => assert.fail("must not sign in"),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.phase, "environment-preflight");
});

test("requires every exercise and verified cleanup", async () => {
  for (const result of [
    success,
    { ...success, cleanup: "unknown" },
    { ...success, checks: {} },
  ]) {
    const report = await runNativeJourney({
      account: JSON.stringify(fixture),
      health,
      journey: async () => result,
    });
    assert.equal(report.status, result === success ? "passed" : "failed");
  }
});

test("failure diagnostics retain phase but never credential-bearing errors", async () => {
  const saved = [];
  const report = await runNativeJourney({
    account: JSON.stringify(fixture),
    health,
    save: (r) => saved.push(r),
    journey: async ({ phase }) => {
      phase("registered-account-login");
      throw new Error(
        `${fixture.email} ${fixture.password} https://private.invalid/?token=secret`,
      );
    },
  });
  assert.equal(report.status, "failed");
  assert.equal(report.phase, "registered-account-login");
  assert.doesNotMatch(
    JSON.stringify(saved),
    /registered@example|not-a-real|private.invalid|token=/,
  );
});

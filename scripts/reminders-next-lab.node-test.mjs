import assert from "node:assert/strict";
import { test } from "node:test";
import { assessPreflight, LAB } from "./e2e/reminders-next-lab.mjs";

const registry = { connect_origin: LAB, loopback_port: 28487 };
const metadata = { environment: "lab" };
const health = { environment: "lab", public_origin: LAB };

test("LAB public identity does not authorize the forbidden legacy doctor/status path", () => {
  const result = assessPreflight(registry, metadata, health);
  assert.equal(result.result, "blocked");
  assert.equal(result.identity, "verified");
  assert.equal(result.daemonInvoked, false);
  assert.equal(result.browserUsed, false);
  assert.ok(
    result.blockers.includes("doctor-status-select-forbidden-legacy-daemon"),
  );
});

test("changing the daemon port does not establish NEXT browser or real push readiness", () => {
  const result = assessPreflight(
    { ...registry, loopback_port: 30000 },
    metadata,
    health,
  );
  assert.equal(result.result, "blocked");
  assert.ok(
    result.blockers.includes(
      "public-metadata-does-not-establish-current-next-browser-build-or-remote-push-readiness",
    ),
  );
});

test("missing or mismatched public LAB identity fails closed", () => {
  for (const value of [
    undefined,
    {},
    { environment: "production", public_origin: LAB },
    { environment: "lab", public_origin: "https://connect.mdbase.dev" },
  ]) {
    const result = assessPreflight(registry, metadata, value);
    assert.equal(result.identity, "mismatch");
    assert.equal(result.result, "blocked");
  }
  assert.equal(assessPreflight({}, metadata, health).identity, "mismatch");
  assert.equal(assessPreflight(registry, {}, health).identity, "mismatch");
});

test("preflight output excludes arbitrary metadata and account fields", () => {
  const result = assessPreflight(
    { ...registry, account: "DO-NOT-OUTPUT" },
    { ...metadata, session: "DO-NOT-OUTPUT" },
    { ...health, token: "DO-NOT-OUTPUT" },
  );
  assert.ok(!JSON.stringify(result).includes("DO-NOT-OUTPUT"));
});

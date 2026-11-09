import test from "node:test";
import assert from "node:assert/strict";
import {
  assertLinesOpen,
  latestExactGreen,
  LINES,
} from "./mobile-release-policy.mjs";

test("exact CI cannot borrow success from an old attempt or other event", () => {
  const run = {
    id: 1,
    head_sha: "a",
    event: "push",
    head_branch: "main",
    path: ".github/workflows/ios.yml",
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
  };
  assert.equal(latestExactGreen([run], "a", "ios.yml"), true);
  assert.equal(
    latestExactGreen(
      [run, { ...run, run_attempt: 2, conclusion: "failure" }],
      "a",
      "ios.yml",
    ),
    false,
  );
  assert.equal(
    latestExactGreen([{ ...run, event: "pull_request" }], "a", "ios.yml"),
    false,
  );
});

test("store holds cannot address a server line or each other", () => {
  assert.deepEqual(LINES, {
    android: "tasknotes-google-play",
    ios: "tasknotes-app-store",
  });
});

test("the Actions-only bridge checks target and whole-app stops without an Issues grant", async () => {
  await assertLinesOpen("android", async () => ({
    stopped: false,
    app_stopped: false,
  }));
  for (const state of [
    { stopped: true, app_stopped: false },
    { stopped: false, app_stopped: true },
    { stopped: false },
  ]) {
    await assert.rejects(assertLinesOpen("android", async () => state));
  }
});

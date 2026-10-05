import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

async function workflow(name) {
  return parse(
    await readFile(
      new URL(`../.github/workflows/${name}.yml`, import.meta.url),
      "utf8",
    ),
  );
}

test("Android signed candidate is opt-in and does not use publication credentials", async () => {
  const android = await workflow("android");
  const input = android.on.workflow_dispatch.inputs.signed_candidate;
  assert.equal(input.type, "boolean");
  assert.equal(input.default, false);
  assert.match(
    android.jobs.release.if,
    /github.event_name == 'workflow_dispatch' && inputs.signed_candidate/,
  );
  assert.equal(android.jobs.release.needs, "build");
  const release = JSON.stringify(android.jobs.release);
  assert.ok(
    release.includes(
      "tasknotes-android-candidate-${GITHUB_SHA}-${GITHUB_RUN_NUMBER}",
    ),
  );
  assert.ok(!release.includes("GOOGLE_PLAY_SERVICE_ACCOUNT"));
  assert.ok(!release.includes("publish-google-play"));
  assert.ok(!release.includes("gh release"));
});

test("Play publisher rejects build-only manual dispatches", async () => {
  const play = await workflow("google-play-closed-testing");
  const gate = play.jobs["verify-release"].if;
  assert.match(gate, /workflow_run.event == 'push'/);
  assert.match(
    gate,
    /startsWith\(github.event.workflow_run.head_branch, 'android-v'\)/,
  );
  assert.equal(
    play.jobs["publish-play-closed-testing"].needs,
    "verify-release",
  );
});

test("iOS candidate dispatch defaults to neither upload nor submission", async () => {
  const ios = await workflow("ios-release");
  assert.equal(ios.on.workflow_dispatch.inputs.upload.default, false);
  assert.equal(ios.on.workflow_dispatch.inputs.submit_public.default, false);
});

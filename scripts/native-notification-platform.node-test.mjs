import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

for (const platform of ["ios", "android"]) {
  test(`${platform} ordinary native CI is credential-free shell lifecycle only`, async () => {
    const workflow = parse(
      await source(`../.github/workflows/${platform}.yml`),
    );
    const job = workflow.jobs.build;
    const buildConfiguration = JSON.stringify({ env: workflow.env, job });
    assert.doesNotMatch(
      buildConfiguration,
      /\bsecrets\.|\bvars\.|\benvironment\b/,
    );
    assert.doesNotMatch(
      buildConfiguration,
      /assembleRelease|bundleRelease|archivePath|exportArchive|altool|--submit|publish-google-play|android-smoke\.mjs/,
    );
    const guard = job.steps.find(
      (step) => step.name === "Require credential-free native configuration",
    );
    assert.match(guard.run, /test -z "\$\{TASKNOTES_FIREBASE_PROJECT_ID:-\}"/);
    assert.match(guard.run, /test ! -e /);
    const smoke = job.steps.find((step) =>
      step.name.startsWith("Install and restart"),
    );
    assert.ok(smoke["timeout-minutes"] <= 15);
    if (platform === "ios") {
      const build = job.steps.find(
        (step) => step.name === "Build iOS simulator application",
      );
      assert.match(build.run, /CODE_SIGNING_ALLOWED=NO/);
      assert.match(build.run, /-derivedDataPath build\/ios-simulator/);
      assert.match(smoke.run, /simctl install/);
      assert.equal((smoke.run.match(/simctl launch/g) ?? []).length, 2);
      assert.match(smoke.run, /simctl terminate/);
      assert.match(smoke.run, /trap .*simctl shutdown/);
      assert.equal(workflow.jobs.release, undefined);
    } else {
      assert.match(smoke.with.script, /adb install/);
      assert.equal((smoke.with.script.match(/am start/g) ?? []).length, 2);
      assert.match(smoke.with.script, /am force-stop/);
      assert.equal((smoke.with.script.match(/pidof/g) ?? []).length, 2);
      assert.equal(
        workflow.jobs.release.if,
        "startsWith(github.ref, 'refs/tags/android-v')",
      );
    }
  });
}

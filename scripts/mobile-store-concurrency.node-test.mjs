import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

test("Android store dispatches serialize separately from push and PR CI", async () => {
  const workflow = parse(
    await readFile(
      new URL("../.github/workflows/android.yml", import.meta.url),
      "utf8",
    ),
  );
  // The store key is stable across source SHAs, versions, and run IDs, while
  // push/PR events on the same ref can only enter the CI group.
  assert.equal(
    workflow.concurrency.group,
    "android-${{ github.event_name == 'workflow_dispatch' && 'store' || 'ci' }}-${{ github.ref }}",
  );
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
});

test("other store build and publish workflows keep dispatch-only non-cancelling locks", async () => {
  for (const [file, group] of [
    ["ios-release.yml", "ios-release-${{ github.ref }}"],
    ["google-play-production.yml", "google-play-production"],
    ["app-store-submit.yml", "app-store-production"],
    ["publish-tasknotes-store.yml", "tasknotes-store-${{ inputs.target }}"],
  ]) {
    const workflow = parse(
      await readFile(
        new URL("../.github/workflows/" + file, import.meta.url),
        "utf8",
      ),
    );
    assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"], file);
    assert.equal(workflow.concurrency.group, group, file);
    assert.equal(workflow.concurrency["cancel-in-progress"], false, file);
  }
});

test("Play snapshots and production edits share one non-cancelling lock", async () => {
  for (const [file, job] of [
    ["google-play-production.yml", null],
    ["store-status.yml", "android"],
  ]) {
    const workflow = parse(
      await readFile(
        new URL("../.github/workflows/" + file, import.meta.url),
        "utf8",
      ),
    );
    const concurrency = job
      ? workflow.jobs[job].concurrency
      : workflow.concurrency;
    assert.equal(concurrency.group, "google-play-production");
    assert.equal(concurrency["cancel-in-progress"], false);
  }
});

test("only App CD coordinates stores; main CI never signs or submits on a tag", async () => {
  for (const file of ["android.yml", "ios-release.yml"]) {
    const workflow = parse(
      await readFile(
        new URL("../.github/workflows/" + file, import.meta.url),
        "utf8",
      ),
    );
    assert.equal(workflow.on.push?.tags, undefined);
    assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs).sort(), [
      "source_sha",
      "version",
    ]);
    const release = workflow.jobs.release;
    const gate = release.steps.findIndex(
      (step) =>
        step.name === "Qualify exact main source before dependency execution",
    );
    const checkout = release.steps.findIndex(
      (step) => step.name === "Check out qualified build source",
    );
    assert.ok(gate > 0 && checkout > gate);
    assert.ok(
      release.steps
        .slice(0, gate)
        .every((step) => !String(step.run).includes("pnpm")),
    );
  }
});

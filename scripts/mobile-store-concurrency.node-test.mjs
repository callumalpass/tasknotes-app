import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

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

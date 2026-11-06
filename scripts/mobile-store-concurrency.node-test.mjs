import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
test("alpha, production, snapshot and monitor edits serialize on one Play lock", async () => {
  for (const [file, job] of [
    ["google-play-closed-testing.yml", "publish-play-closed-testing"],
    ["google-play-production.yml", null],
    ["store-status.yml", "android"],
    ["mobile-post-release.yml", "play"],
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

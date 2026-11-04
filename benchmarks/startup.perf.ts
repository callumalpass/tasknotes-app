import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cpus } from "node:os";
import { expect, it } from "vitest";
import { seedTask, seedTaskView } from "../src/test/next-task-fixture";
import {
  STAND_IN,
  benchmarkReplica,
  emptyWork,
  meteredTaskNotes,
} from "./sdk-stand-in";

it("measures configuration to first usable saved-view page", async () => {
  const results = [];
  for (const size of (process.env.PERF_SIZES ?? "10000,50000")
    .split(",")
    .map(Number)) {
    const replica = benchmarkReplica();
    for (let index = 0; index < size; index++)
      seedTask(
        replica,
        { title: `Task ${index}`, body: "x".repeat(2048) },
        { id: `task-${index}` },
      );
    seedTaskView(replica, { columns: ["file.path", "title", "status"] });
    const work = emptyWork();
    const { repository, close } = await meteredTaskNotes(replica, () => work);
    Object.assign(work, emptyWork());
    globalThis.gc?.();
    const started = performance.now();
    await repository.initialize({ deferTaskIndex: true });
    const configuredMs = performance.now() - started;
    const [document] = await repository.listViews();
    // The view screen's first page: the native window, not the full result.
    const stream = repository.iterateView(document.views[0], {
      cumulative: true,
    });
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    const firstViewMs = performance.now() - started;
    expect(first.value!.rows).toHaveLength(Math.min(200, size));
    expect(first.value!.rows[0].task.id).toBe("task-0");
    const firstViewWork = { ...work };
    const indexStarted = performance.now();
    expect(await repository.stats()).toMatchObject({ total: size });
    const remainingIndexMs = performance.now() - indexStarted;
    results.push({
      size,
      configuredMs: +configuredMs.toFixed(2),
      firstViewMs: +firstViewMs.toFixed(2),
      firstViewWork,
      remainingIndexMs: +remainingIndexMs.toFixed(2),
      totalWork: { ...work },
    });
    await iterator.return?.();
    close();
  }
  const output =
    process.env.PERF_STARTUP_OUTPUT ?? "benchmarks/results/startup-latest.json";
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(
    output,
    JSON.stringify(
      {
        revision: process.env.PERF_REVISION ?? "working-tree",
        node: process.version,
        cpu: cpus()[0]?.model,
        samples: 1,
        environment: `${STAND_IN}. Repository first page, not React paint. Full index is requested after the first page to measure deferred work separately.`,
        results,
      },
      null,
      2,
    ) + "\n",
  );
});

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cpus } from "node:os";
import { expect, it } from "vitest";
import { seedTask } from "../src/test/next-task-fixture";
import {
  STAND_IN,
  benchmarkReplica,
  emptyWork,
  meteredTaskNotes,
  type Work,
} from "./sdk-stand-in";

// Measures the app layer over the real SDK client, not Core's query engine or
// network latency. Work counters are the replica's encoded responses and the
// records/body text the SDK client hands the repository.
it("benchmarks large collections", async () => {
  const sizes = (process.env.PERF_SIZES ?? "10000,50000")
    .split(",")
    .map(Number);
  const rounds = Number(process.env.PERF_ROUNDS ?? 7);
  const report: Record<string, unknown> = {
    node: process.version,
    cpu: cpus()[0]?.model,
    rounds,
    revision: process.env.PERF_REVISION ?? "working-tree",
    sdkVersion: JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ).dependencies["@mdbase-dev/sdk"],
    bodyBytesPerRecord: 2048,
    environment: STAND_IN,
    results: [],
  };
  for (const size of sizes) {
    const replica = benchmarkReplica();
    const body = (index: number) =>
      (`Notes for ${index}. ` + "ordinary note text ".repeat(130)).slice(
        0,
        2048,
      );
    const recordIds: string[] = [];
    for (let index = 0; index < size; index++)
      recordIds.push(
        seedTask(
          replica,
          {
            title: `Task ${index}`,
            status: "open",
            tags: [`tag-${index % 50}`],
            body: body(index),
          },
          { id: `task-${index}` },
        ).id,
      );
    let counters: Work = emptyWork();
    const { repository, close } = await meteredTaskNotes(
      replica,
      () => counters,
    );
    const list = repository.listSummaries.bind(repository);
    const search = repository.search.bind(repository);
    expect(globalThis.gc).toBeTypeOf("function");
    globalThis.gc!();
    const heapBeforeInitialize = process.memoryUsage().heapUsed;
    const measurements: Record<string, unknown> = {};
    const measure = async (
      name: string,
      operation: () => Promise<unknown>,
      samples = rounds,
    ) => {
      const times: number[] = [];
      const work: Work[] = [];
      for (let round = 0; round < samples; round++) {
        counters = emptyWork();
        const start = performance.now();
        await operation();
        times.push(performance.now() - start);
        work.push({ ...counters });
      }
      times.sort((a, b) => a - b);
      measurements[name] = {
        medianMs: +times[Math.floor(times.length / 2)].toFixed(2),
        p95Ms:
          +times[
            Math.min(times.length - 1, Math.floor(times.length * 0.95))
          ].toFixed(2),
        work,
      };
    };
    await measure("initialize", () => repository.initialize(), 1);
    expect((await repository.stats()).total).toBe(size);
    // The metadata index never asks the client for Notes text.
    expect(counters.bodyBytes).toBe(0);
    globalThis.gc!();
    const retainedAfterInitializeMiB = +(
      (process.memoryUsage().heapUsed - heapBeforeInitialize) /
      1024 ** 2
    ).toFixed(2);
    await measure(
      "firstDetail",
      async () => {
        expect((await repository.get(`task-${size - 1}`))?.body).toBe(
          body(size - 1),
        );
      },
      1,
    );
    await measure("cachedDetail", () => repository.get(`task-${size - 1}`));
    await measure("unchangedRefresh", () => repository.refresh());
    await measure("listZero", () => list({ status: "all", limit: 0 }));
    await measure("list300", () => list({ status: "all", limit: 300 }));
    await measure("searchBody", async () => {
      expect(
        await search({ status: "all", search: "ordinary note", limit: 300 }),
      ).toHaveLength(Math.min(300, size));
    });
    await measure(
      "searchColdRare",
      async () => {
        const results = await search({
          status: "all",
          search: `Notes for ${size - 1}.`,
          limit: 300,
        });
        expect(results.map((row) => row.task.id)).toEqual([`task-${size - 1}`]);
      },
      1,
    );
    await measure("searchRare", () =>
      search({
        status: "all",
        search: `Notes for ${size - 1}.`,
        limit: 300,
      }),
    );
    let edits = 0;
    await measure("singleRecordRefresh", async () => {
      // Another device edits one task; its change arrives confirmed.
      const title = `Changed elsewhere ${++edits}`;
      replica.editElsewhere(recordIds[0]!, { frontmatter: { title } });
      const result = await repository.refresh();
      expect(result.scanned).toBe(size);
      expect((await repository.getSummary("task-0"))?.title).toBe(title);
    });
    await measure(
      "listAfterMutation",
      () => list({ status: "all", limit: 300 }),
      1,
    );
    await measure(
      "hydrate300",
      async () => {
        expect(
          await repository.list({ status: "all", limit: 300 }),
        ).toHaveLength(Math.min(300, size));
      },
      1,
    );
    await measure(
      "editHydrated",
      async () => {
        const task = (await list({ status: "all", limit: 300 })).at(-1)!;
        await repository.update(task.id, { title: "Edit hydrated document" });
      },
      1,
    );
    await measure(
      "acceptedMetadataEdit",
      () =>
        repository.update(`task-${size - 1}`, {
          title: "Changed through the authority",
        }),
      1,
    );
    globalThis.gc!();
    const retainedAfterQueriesMiB = +(
      (process.memoryUsage().heapUsed - heapBeforeInitialize) /
      1024 ** 2
    ).toFixed(2);
    (report.results as unknown[]).push({
      size,
      retainedAfterInitializeMiB,
      retainedAfterQueriesMiB,
      measurements,
    });
    close();
  }
  const destination =
    process.env.PERF_OUTPUT ?? "benchmarks/results/latest.json";
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, JSON.stringify(report, null, 2) + "\n");
  console.log(`Performance evidence: ${destination}`);
});

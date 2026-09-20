import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cpus } from "node:os";
import { expect, it } from "vitest";
import { connectSuccess } from "@mdbase-dev/connect-testing";
import {
  mdbaseFixture,
  taskRecord,
  testQueryFile,
} from "../src/test/mdbase-fixture";

it("measures configuration to first usable saved-view page", async () => {
  const { MdbaseTaskRepository } = (await import(
    process.env.PERF_REPOSITORY_MODULE ?? "../src/storage/mdbase-repository"
  )) as typeof import("../src/storage/mdbase-repository");
  const results = [];
  for (const size of (process.env.PERF_SIZES ?? "10000,50000")
    .split(",")
    .map(Number)) {
    const records = Array.from({ length: size }, (_, index) => ({
      ...taskRecord(`task-${index}`, `Task ${index}`, `r${index}`),
      body: "x".repeat(2048),
    }));
    const fixture = mdbaseFixture(records);
    let requests = 0,
      rows = 0,
      responseBytes = 0,
      bodyBytes = 0;
    const transfer = <T>(value: T): T => {
      requests++;
      const json = JSON.stringify(value);
      responseBytes += Buffer.byteLength(json);
      const envelope = value as {
        result?: { results?: { body?: string }[] };
        value?: { results?: { body?: string }[] };
      };
      const records = envelope.value?.results ?? envelope.result?.results ?? [];
      rows += records.length;
      bodyBytes += records.reduce(
        (sum, record) => sum + Buffer.byteLength(record.body ?? ""),
        0,
      );
      return JSON.parse(json);
    };
    const description = await fixture.describe();
    const catalogue = await fixture.listViews();
    catalogue.result.views[0].views[0].presentation.type =
      "tasknotes.task-list";
    fixture.describe.mockImplementation(async () => transfer(description));
    fixture.listViews.mockImplementation(async () => transfer(catalogue));
    fixture.queryPages.mockImplementation((input) =>
      (async function* () {
        for (let offset = 0; offset < records.length; offset += 1000) {
          const batch = records.slice(offset, offset + 1000).map((record) => ({
            path: record.path,
            effectiveFrontmatter: record.frontmatter,
            types: record.types,
            file: testQueryFile(record.path),
            ...(input?.includeBody ? { body: record.body } : {}),
          }));
          yield transfer(
            connectSuccess({
              results: batch,
              meta: { hasMore: offset + batch.length < size },
              page: offset / 1000,
              offset,
              loaded: offset + batch.length,
              complete: offset + batch.length >= size,
            }),
          );
        }
      })(),
    );
    fixture.connect.executeViewPages = () =>
      (async function* () {
        const batch = records.slice(0, 200).map((record) => ({
          path: record.path,
          effectiveFrontmatter: record.frontmatter,
          types: record.types,
          file: testQueryFile(record.path),
          values: { status: "open" },
        }));
        yield transfer(
          connectSuccess({
            results: batch,
            meta: {
              totalCount: size,
              hasMore: size > 200,
              view: { path: "views/tasks.base", id: "kanban" },
              groups: [],
            },
            page: 0,
            offset: 0,
            loaded: batch.length,
            complete: size <= 200,
          }),
        );
      })();
    const repository = new MdbaseTaskRepository(fixture.connect);
    globalThis.gc?.();
    const started = performance.now();
    await repository.initialize({ deferTaskIndex: true });
    const configuredMs = performance.now() - started;
    const [document] = await repository.listViews();
    const stream = repository.iterateView(document.views[0]);
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    const firstViewMs = performance.now() - started;
    expect(first.value.rows).toHaveLength(Math.min(200, size));
    expect(first.value.rows[0].task.id).toBe("task-0");
    expect(rows).toBeGreaterThanOrEqual(Math.min(200, size));
    const firstViewWork = { requests, rows, responseBytes, bodyBytes };
    const indexStarted = performance.now();
    expect(await repository.stats()).toMatchObject({ total: size });
    const remainingIndexMs = performance.now() - indexStarted;
    results.push({
      size,
      configuredMs: +configuredMs.toFixed(2),
      firstViewMs: +firstViewMs.toFixed(2),
      firstViewWork,
      remainingIndexMs: +remainingIndexMs.toFixed(2),
      totalWork: { requests, rows, responseBytes, bodyBytes },
    });
    await iterator.return?.();
    repository.dispose();
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
        environment:
          "Synthetic serialized authority; repository first page, not React paint, network or real query-engine latency. Full index is requested after the first page to measure deferred work separately.",
        results,
      },
      null,
      2,
    ) + "\n",
  );
});

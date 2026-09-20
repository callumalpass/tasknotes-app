import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cpus } from "node:os";
import { expect, it } from "vitest";
import { connectSuccess } from "@mdbase-dev/connect-testing";
import type { CollectionChange, QueryInput } from "@mdbase-dev/connect";
import {
  mdbaseFixture,
  taskRecord,
  testQueryFile,
} from "../src/test/mdbase-fixture";

// Measures the app layer, not Connect's query engine or network latency. The
// authority double serializes/parses every response to avoid sharing objects
// across the boundary and records deterministic transfer/work counters.
it("benchmarks large collections", async () => {
  const { MdbaseTaskRepository } = (await import(
    process.env.PERF_REPOSITORY_MODULE ?? "../src/storage/mdbase-repository"
  )) as typeof import("../src/storage/mdbase-repository");
  const sizes = (process.env.PERF_SIZES ?? "10000,50000")
    .split(",")
    .map(Number);
  const rounds = Number(process.env.PERF_ROUNDS ?? 7);
  const report: Record<string, unknown> = {
    node: process.version,
    cpu: cpus()[0]?.model,
    rounds,
    revision: process.env.PERF_REVISION ?? "working-tree",
    connectVersion: "0.1.0-beta.96",
    taskModelVersion: "0.3.0-rc.11",
    bodyBytesPerRecord: 2048,
    environment:
      "synthetic serialized authority; no network or provider query-engine timing",
    results: [],
  };
  for (const size of sizes) {
    const template = taskRecord("template", "Template", "r0");
    const records = Array.from({ length: size }, (_, index) => ({
      ...template,
      path: `tasks/task-${String(index).padStart(6, "0")}.md`,
      revision: `r${index}`,
      frontmatter: {
        ...template.frontmatter,
        id: `task-${index}`,
        title: `Task ${index}`,
        status: "open",
        tags: [`tag-${index % 50}`],
      },
      body: (`Notes for ${index}. ` + "ordinary note text ".repeat(130)).slice(
        0,
        2048,
      ),
    }));
    const fixture = mdbaseFixture(records);
    let cursor = 0;
    const events: CollectionChange[] = [];
    let counters = { requests: 0, records: 0, responseBytes: 0, bodyBytes: 0 };
    const transfer = <T>(value: T): T => {
      counters.requests++;
      const json = JSON.stringify(value);
      counters.responseBytes += Buffer.byteLength(json);
      return JSON.parse(json);
    };
    const describe = await fixture.describe();
    fixture.describe.mockImplementation(async () =>
      transfer({
        ...describe,
        operations: [...describe.operations, "changes"],
        changeCursor: cursor,
      }),
    );
    Object.assign(fixture.connect, {
      changes: async ({ after = 0, limit = 1000 } = {}) => {
        const batch = events
          .filter((event) => event.cursor > after)
          .slice(0, limit);
        return transfer(
          connectSuccess({
            events: batch,
            cursor: batch.at(-1)?.cursor ?? cursor,
            hasMore: events.some(
              (event) => event.cursor > (batch.at(-1)?.cursor ?? cursor),
            ),
            reset: false,
          }),
        );
      },
    });
    fixture.queryPages.mockImplementation((input?: QueryInput) =>
      (async function* () {
        // Changed-path queries use exact equality disjunctions, not a fake index
        // shared with the client. CPU spent selecting rows is not a real engine benchmark.
        const paths = input?.where
          ? new Set(
              [
                ...input.where.matchAll(/file\.path == ("(?:[^"\\]|\\.)*")/g),
              ].map((match) => JSON.parse(match[1])),
            )
          : null;
        const matching = [...fixture.records.values()].filter(
          (record) => !paths || paths.has(record.path),
        );
        for (
          let offset = 0;
          offset < matching.length || offset === 0;
          offset += 1000
        ) {
          const batch = matching.slice(offset, offset + 1000);
          counters.records += batch.length;
          const results = batch.map((record) => {
            const body = input?.includeBody ? record.body : undefined;
            counters.bodyBytes += body ? Buffer.byteLength(body) : 0;
            return {
              path: record.path,
              effectiveFrontmatter: record.frontmatter,
              body,
              types: record.types,
              file: testQueryFile(record.path),
            };
          });
          yield transfer(
            connectSuccess({
              results,
              meta: {
                hasMore: offset + batch.length < matching.length,
                totalCount: matching.length,
              },
              page: offset / 1000,
              offset,
              loaded: offset + batch.length,
              complete: offset + batch.length >= matching.length,
            }),
          );
        }
      })(),
    );
    const read = fixture.read.getMockImplementation()!;
    fixture.read.mockImplementation(async (input) => {
      const response = await read(input);
      counters.records++;
      counters.bodyBytes += Buffer.byteLength(response.result.body);
      return transfer(response);
    });
    const repository = new MdbaseTaskRepository(fixture.connect);
    const measurements: Record<string, unknown> = {};
    const measure = async (
      name: string,
      operation: () => Promise<unknown>,
      samples = rounds,
    ) => {
      const times: number[] = [];
      const work: (typeof counters)[] = [];
      for (let round = 0; round < samples; round++) {
        counters = { requests: 0, records: 0, responseBytes: 0, bodyBytes: 0 };
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
    await measure("unchangedRefresh", () => repository.refresh());
    await measure("listZero", () =>
      repository.list({ status: "all", limit: 0 }),
    );
    await measure("list300", () =>
      repository.list({ status: "all", limit: 300 }),
    );
    await measure("searchBody", () =>
      repository.list({ status: "all", search: "ordinary note", limit: 300 }),
    );
    await measure(
      "searchColdRare",
      () =>
        repository.list({
          status: "all",
          search: `Notes for ${size - 1}.`,
          limit: 300,
        }),
      1,
    );
    await measure("searchRare", () =>
      repository.list({
        status: "all",
        search: `Notes for ${size - 1}.`,
        limit: 300,
      }),
    );
    await measure("singleRecordRefresh", async () => {
      const old = fixture.records.get(records[0].path)!;
      fixture.records.set(old.path, {
        ...old,
        revision: `changed-${++cursor}`,
        body: `Changed ${cursor}. ` + old.body.slice(20),
      });
      events.push({
        cursor,
        type: "mdbase.record.modified",
        occurredAt: "2026-09-19T00:00:00Z",
        payload: { path: old.path, types: ["task"] },
      });
      const result = await repository.refresh();
      expect(result.changed).toBe(1);
    });
    await measure(
      "listAfterMutation",
      () => repository.list({ status: "all", limit: 300 }),
      1,
    );
    (report.results as unknown[]).push({ size, measurements });
    repository.dispose();
  }
  const destination =
    process.env.PERF_OUTPUT ?? "benchmarks/results/latest.json";
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, JSON.stringify(report, null, 2) + "\n");
  console.log(`Performance evidence: ${destination}`);
});

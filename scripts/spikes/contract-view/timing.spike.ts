/**
 * Full read of N tasks: the app's path (ordinary pages of 1000 with effective
 * frontmatter, then TaskNotesTaskModel.readSummary per record) against
 * queryContract pages. queryContract starts at 128 and halves the page on
 * `too_large`, since a full page of ordinary tasks exceeds its budget.
 * Bytes are the CBOR size of every frame the runtime sent back.
 *
 *   SPIKE_SIZES=2000,10000 SPIKE_RUNS=5 pnpm exec vitest run --config scripts/spikes/contract-view/vitest.config.ts timing
 */
import {
  connect,
  encode,
  inProcessConnector,
  type FramePort,
} from "@mdbase-dev/sdk";
import { test } from "vitest";
import { nextTaskCatalog } from "../../../src/storage/next-task-catalog";
import { nextTaskSummary } from "../../../src/storage/next-task-records";
import { openReplica, plainTask, seed } from "./harness";

const SIZES = (process.env.SPIKE_SIZES ?? "2000,10000").split(",").map(Number);
const RUNS = Number(process.env.SPIKE_RUNS ?? 5);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2
    ? s[(s.length - 1) / 2]!
    : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

test("full read timing", async () => {
  const rows: string[] = [];
  for (const n of SIZES) {
    const r = await openReplica();
    const t0 = performance.now();
    await seed(
      r.client,
      Array.from({ length: n }, (_, i) => ({
        path: `tasks/t${i}.md`,
        frontmatter: plainTask(i),
        body: `Notes for task ${i}.`,
      })),
      200,
    );
    console.log(`seeded ${n} in ${Math.round(performance.now() - t0)} ms`);
    let bytes = 0;
    const metered = await connect({
      app: { name: "timing-spike", version: "0" },
      reconnect: false,
      connector: {
        description: "metered",
        async open(hello, signal) {
          const opened = await inProcessConnector(r.runtime).open(
            hello,
            signal,
          );
          const port = opened.port;
          const wrapped = {
            send: (f: never) => port.send(f),
            close: () => port.close(),
            get onframe() {
              return port.onframe;
            },
            set onframe(fn) {
              port.onframe =
                fn &&
                ((f: Parameters<NonNullable<FramePort["onframe"]>>[0]) => {
                  bytes += encode(f).byteLength;
                  fn(f);
                });
            },
            get onclose() {
              return port.onclose;
            },
            set onclose(fn) {
              port.onclose = fn;
            },
          } as FramePort;
          return { ...opened, port: wrapped };
        },
      },
    });
    const signal = new AbortController().signal;
    const { providers } = await nextTaskCatalog(metered, signal);
    const models = new Map(providers.map((p) => [p.typeName, p.model]));

    const app = {
      total: [] as number[],
      raw: [] as number[],
      bytes: [] as number[],
      tasks: 0,
      pages: 0,
    };
    const contract = {
      total: [] as number[],
      bytes: [] as number[],
      records: 0,
      pages: 0,
      pageSize: 0,
      refusals: 0,
    };
    for (let run = 0; run < RUNS; run++) {
      // App path.
      bytes = 0;
      let rawMs = 0;
      let tasks = 0;
      let pages = 0;
      const a0 = performance.now();
      const it = metered.pages(
        { types: [...models.keys()], limit: 1000 },
        { effective: true },
        signal,
      );
      for (;;) {
        const r0 = performance.now();
        const next = await it.next();
        rawMs += performance.now() - r0;
        if (next.done) break;
        pages++;
        for (const record of next.value.records)
          if (nextTaskSummary(record, models)) tasks++;
      }
      app.total.push(performance.now() - a0);
      app.raw.push(rawMs);
      app.bytes.push(bytes);
      app.tasks = tasks;
      app.pages = pages;

      // Contract path.
      bytes = 0;
      let size = 128;
      let cursor: string | undefined;
      let records = 0;
      let cpages = 0;
      let refusals = 0;
      let done = false;
      const c0 = performance.now();
      while (!done) {
        try {
          const q = await metered.queryContract(r.contract, {
            pageSize: size,
            cursor,
          });
          records += q.records.length;
          cpages++;
          cursor = q.page.cursor;
          done = !cursor;
        } catch (e) {
          if ((e as { code?: string }).code !== "too_large" || size === 1)
            throw e;
          refusals++;
          size = Math.floor(size / 2);
        }
      }
      contract.total.push(performance.now() - c0);
      contract.bytes.push(bytes);
      contract.records = records;
      contract.pages = cpages;
      contract.pageSize = size;
      contract.refusals = refusals;
    }
    rows.push(
      `| ${n} | app: pages(1000)+readSummary | ${median(app.total).toFixed(0)} | ${median(app.raw).toFixed(0)} | ${app.pages} | ${app.tasks} | ${(median(app.bytes) / 1024).toFixed(0)} | ${app.total.map((x) => x.toFixed(0)).join(", ")} |`,
      `| ${n} | queryContract (page ${contract.pageSize}, ${contract.refusals} too_large first) | ${median(contract.total).toFixed(0)} | – | ${contract.pages} | ${contract.records} | ${(median(contract.bytes) / 1024).toFixed(0)} | ${contract.total.map((x) => x.toFixed(0)).join(", ")} |`,
    );
    metered.close?.();
    await r.close();
  }
  console.log(`runs per cell: ${RUNS}; node ${process.version}`);
  console.log(
    "| tasks | path | median ms | of which replica reads ms | pages | records | median KiB received | all runs ms |",
  );
  console.log("|---|---|---|---|---|---|---|---|");
  for (const row of rows) console.log(row);
});

import { chromium } from "@playwright/test";

const baseUrl = process.env.TASKNOTES_BENCHMARK_URL ?? "http://127.0.0.1:4173/";
const counts = (process.env.TASKNOTES_BENCHMARK_COUNTS ?? "1000,10000,50000")
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value) && value > 0)
  .sort((left, right) => left - right);
const runs = Math.max(
  1,
  Number.parseInt(process.env.TASKNOTES_BENCHMARK_RUNS ?? "3", 10),
);

if (!counts.length) throw new Error("No valid benchmark record counts.");

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  const localChoice = page.getByRole("button", { name: /On this device/ });
  if (await localChoice.isVisible()) {
    await localChoice.click();
    await page.getByRole("heading", { name: "Today" }).waitFor();
  }

  const environment = await page.evaluate(() => ({
    hardwareConcurrency: navigator.hardwareConcurrency,
    userAgent: navigator.userAgent,
  }));
  const measurements = [];

  for (const count of counts) {
    const writeMs = await writeFixture(page, count);
    for (let run = 1; run <= runs; run += 1) {
      const measurement = await page.evaluate(
        async ({ count: recordCount, run: runNumber }) => {
          const [
            { IndexedMarkdownRepository },
            { TaskIndex },
            { MarkdownCollection },
            { OpfsVault },
          ] = await Promise.all([
            import("/src/storage/repository.ts"),
            import("/src/storage/index.ts"),
            import("/src/storage/collection.ts"),
            import("/src/storage/vault-opfs.ts"),
          ]);
          const databaseName = `tasknotes-local-index-benchmark-${recordCount}-${runNumber}-${crypto.randomUUID()}`;
          const taskReadIntervals = [];
          const taskFileReadIntervals = [];
          let listMs = 0;
          let bulkPutMs = 0;
          const vault = new OpfsVault();
          const originalReadText = vault.readText.bind(vault);
          vault.readText = async (path) => {
            const startedAt = performance.now();
            try {
              return await originalReadText(path);
            } finally {
              if (path.startsWith("tasks/"))
                taskFileReadIntervals.push([startedAt, performance.now()]);
            }
          };
          const collection = new MarkdownCollection(vault);
          const originalList = collection.list.bind(collection);
          collection.list = async () => {
            const startedAt = performance.now();
            try {
              return await originalList();
            } finally {
              listMs += performance.now() - startedAt;
            }
          };
          const originalRead = collection.read.bind(collection);
          collection.read = async (document) => {
            const startedAt = performance.now();
            try {
              return await originalRead(document);
            } finally {
              taskReadIntervals.push([startedAt, performance.now()]);
            }
          };
          const coldIndex = new TaskIndex(databaseName);
          const originalBulkPut = coldIndex.tasks.bulkPut.bind(coldIndex.tasks);
          coldIndex.tasks.bulkPut = async (...args) => {
            const startedAt = performance.now();
            try {
              return await originalBulkPut(...args);
            } finally {
              bulkPutMs += performance.now() - startedAt;
            }
          };
          const coldRepository = new IndexedMarkdownRepository({
            collection,
            index: coldIndex,
          });
          const coldStartedAt = performance.now();
          await coldRepository.initialize();
          const coldInitializeMs = performance.now() - coldStartedAt;
          let firstPublishedMs;
          const indexingStartedAt = performance.now();
          coldRepository.subscribeIndexing((_progress, publishTasks) => {
            if (publishTasks && firstPublishedMs === undefined)
              firstPublishedMs = performance.now() - indexingStartedAt;
          });
          await coldRepository.refresh();
          const coldFullIndexMs = performance.now() - indexingStartedAt;
          const firstListStartedAt = performance.now();
          const firstPage = await coldRepository.list({ limit: 500 });
          const firstListMs = performance.now() - firstListStartedAt;
          coldIndex.close();

          const warmIndex = new TaskIndex(databaseName);
          const warmRepository = new IndexedMarkdownRepository({
            index: warmIndex,
          });
          const warmStartedAt = performance.now();
          await warmRepository.initialize();
          const warmInitializeMs = performance.now() - warmStartedAt;
          const unchangedStartedAt = performance.now();
          const unchanged = await warmRepository.refresh();
          const unchangedWallMs = performance.now() - unchangedStartedAt;
          const stats = await warmRepository.stats();
          warmIndex.close();
          await warmIndex.delete();

          return {
            count: recordCount,
            run: runNumber,
            indexed: stats.total,
            coldInitializeMs,
            firstPublishedMs: firstPublishedMs ?? coldFullIndexMs,
            coldFullIndexMs,
            firstListMs,
            firstPageCount: firstPage.length,
            warmInitializeMs,
            unchangedRefreshMs: unchanged.elapsedMs,
            unchangedRefreshWallMs: unchangedWallMs,
            phases: {
              taskListMs: listMs,
              taskFileReadMs: intervalUnionMs(taskFileReadIntervals),
              taskReadAndParseMs: intervalUnionMs(taskReadIntervals),
              bulkPutMs,
            },
          };

          function intervalUnionMs(intervals) {
            const sorted = [...intervals].sort(
              ([left], [right]) => left - right,
            );
            let total = 0;
            let start = -1;
            let end = -1;
            for (const [nextStart, nextEnd] of sorted) {
              if (nextStart > end) {
                if (end >= 0) total += end - start;
                start = nextStart;
                end = nextEnd;
              } else {
                end = Math.max(end, nextEnd);
              }
            }
            if (end >= 0) total += end - start;
            return total;
          }
        },
        { count, run },
      );
      measurements.push({ ...measurement, fixtureWriteMs: writeMs });
    }
  }

  const summary = counts.map((count) => {
    const rows = measurements.filter(
      (measurement) => measurement.count === count,
    );
    return {
      records: count,
      fixtureWriteMs: rows[0].fixtureWriteMs,
      coldInitializeMs: median(rows.map((row) => row.coldInitializeMs)),
      firstPublishedMs: median(rows.map((row) => row.firstPublishedMs)),
      coldFullIndexMs: median(rows.map((row) => row.coldFullIndexMs)),
      warmInitializeMs: median(rows.map((row) => row.warmInitializeMs)),
      unchangedRefreshMs: median(rows.map((row) => row.unchangedRefreshWallMs)),
      firstListMs: median(rows.map((row) => row.firstListMs)),
      taskListMs: median(rows.map((row) => row.phases.taskListMs)),
      taskReadAndParseMs: median(
        rows.map((row) => row.phases.taskReadAndParseMs),
      ),
      bulkPutMs: median(rows.map((row) => row.phases.bulkPutMs)),
    };
  });

  console.log(JSON.stringify({ environment, runs, measurements }, null, 2));
  console.table(summary);
} finally {
  await browser.close();
}

async function writeFixture(page, count) {
  return page.evaluate(async (recordCount) => {
    const startedAt = performance.now();
    const storageRoot = await navigator.storage.getDirectory();
    const taskNotes = await storageRoot.getDirectoryHandle("TaskNotes", {
      create: true,
    });
    const tasks = await taskNotes.getDirectoryHandle("tasks", { create: true });
    const benchmark = await tasks.getDirectoryHandle("__index_benchmark__", {
      create: true,
    });
    for (let offset = 0; offset < recordCount; offset += 64) {
      const indexes = Array.from(
        { length: Math.min(64, recordCount - offset) },
        (_, index) => offset + index + 1,
      );
      await Promise.all(
        indexes.map(async (index) => {
          const id = `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
          const status = index % 9 === 0 ? "done" : "open";
          const day = String((index % 28) + 1).padStart(2, "0");
          const date = `2020-01-${day}`;
          const timestamp = `${date}T10:00:00.000Z`;
          const completed = status === "done" ? `completedDate: ${date}\n` : "";
          const file = await benchmark.getFileHandle(`${id}.md`, {
            create: true,
          });
          const writable = await file.createWritable();
          await writable.write(`---
type: task
id: ${id}
title: Benchmark task ${index}
status: ${status}
priority: ${index % 17 === 0 ? "high" : "normal"}
dateCreated: ${timestamp}
dateModified: ${timestamp}
${completed}mobileRevision: 1
---

Generated performance fixture ${index}.
`);
          await writable.close();
        }),
      );
    }
    return performance.now() - startedAt;
  }, count);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? Math.round(sorted[middle])
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

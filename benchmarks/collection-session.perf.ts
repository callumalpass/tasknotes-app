import { cpus } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import {
  applyBulkEdits,
  planTaskChange,
} from "../src/application/bulk-task-edit";
import { taskOccurrencesBetween } from "../src/domain/task-occurrence";
import { TaskNotesTaskModel } from "../src/domain/tasknotes-model";
import { emptyViewDraft } from "../src/domain/view-document";
import { groupTaskViewRows } from "../src/domain/view-grouping";
import { tasksForViewDraft } from "../src/domain/view-preview";
import {
  nextTaskFixture,
  seedRecord,
  taskQueryWhere,
} from "../src/test/next-task-fixture";

const fields = ["effort", "client", "team", "area"].map((key) => ({
  id: key,
  key,
  displayName: key,
  type: "text" as const,
}));
const records = Array.from({ length: 10_000 }, (_, i) => ({
  path: `Tasks/T${i}.md`,
  types: ["task"],
  frontmatter: {
    id: `task-${i}`,
    type: "task",
    title: `Review ${10_000 - i}`,
    status: "open",
    priority: "normal",
    tags: [i % 5 ? "work" : "home"],
    projects: [`P${i % 80}`],
    scheduled: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
    ...(i % 4 === 0
      ? { recurrence: i % 8 ? "FREQ=WEEKLY" : "FREQ=DAILY" }
      : {}),
    Effort: "medium",
    client: "A",
    team: "B",
    area: "C",
    dateCreated: "2026-10-01T10:00:00Z",
    dateModified: "2026-10-17T11:00:00Z",
  },
  body: "Task detail. ".repeat(80),
}));

// Opt in separately from the ordinary collections benchmark.
it.runIf(process.env.TASKNOTES_BENCH_SESSION === "1")(
  "profiles a 10k collection session",
  async () => {
    const samples: Record<string, number[]> = {};
    for (let round = 0; round < 5; round++) {
      const fixture = await nextTaskFixture(
        { where: taskQueryWhere, confirmDelayMs: null },
        false,
        { userFields: fields },
      );
      const { repository, replica, client } = fixture;
      try {
        records.forEach((record) => seedRecord(replica, record));
        const model = new TaskNotesTaskModel({ userFields: fields });
        for (const mode of ["cold", "warm"] as const) {
          const time = async <T>(name: string, run: () => T | Promise<T>) => {
            const start = performance.now();
            const value = await run();
            (samples[`${name}.${mode}`] ??= []).push(performance.now() - start);
            return value;
          };
          const tasks = await time("decode", () =>
            records.map((record) => model.readSummary(record)),
          );
          expect(tasks[0]?.customProperties.effort).toBe("medium");
          const count = await time("index", async () => {
            if (mode === "cold") await repository.initialize();
            return (await repository.stats()).total;
          });
          expect(count).toBe(10_000);
          const matches = await time("filterSort", () =>
            tasksForViewDraft(
              {
                ...emptyViewDraft("obsidian-bases"),
                filter: 'note.tags.contains("work")',
                sort: [{ property: "title", direction: "asc" }],
              },
              tasks,
            )!,
          );
          expect(matches).toHaveLength(8000);
          const rows = matches.map((task) => ({
            task,
            values: { project: task.projects[0] },
          }));
          const groups = Array.from(
            new Set(rows.map((row) => row.values.project)),
            (project) => ({
              values: { project },
              count: 125,
              summaries: {},
            }),
          );
          const grouped = await time("group", () =>
            groupTaskViewRows({ groups, rows }),
          );
          expect(grouped.every((group) => group.rows.length === 125)).toBe(
            true,
          );
          const end = `2026-11-${20 + round}`;
          const occurrences = await time("recurrence", () =>
            tasks.reduce(
              (n, t) => n + taskOccurrencesBetween(t, "2026-11-01", end).length,
              0,
            ),
          );
          expect(occurrences).toBeGreaterThan(20_000);
          const selection = await Promise.all(
            tasks.slice(0, 32).map((t) => repository.getSummary(t.id)),
          );
          const change = {
            kind: "tag" as const,
            value: "reviewed",
            remove: mode === "warm",
          };
          const edits = await time("bulkCapture32", () =>
            applyBulkEdits(
              selection.map((t) => t!),
              (task) => planTaskChange(task, change),
              {
                getSummary: (id) => repository.getSummary(id),
                updateTask: (id, input) => repository.update(id, input),
                setTaskArchived: (id, v) => repository.setArchived(id, v),
              },
              "Task changed",
            ),
          );
          expect(edits.failures).toEqual([]);
          expect(edits.receipts).toHaveLength(32);
          expect(await client.pendingWrites()).toHaveLength(32);
          const pending = await time("pendingTitles32", () =>
            repository.unconfirmedTaskTitles(),
          );
          expect(pending).toHaveLength(32);
          await time("ack32", async () => {
            replica.confirmAll();
            const deadline = performance.now() + 10_000;
            while (
              repository.unconfirmedTaskTitles() !== undefined ||
              client.ledger.getSnapshot().saveState !== "saved"
            ) {
              if (performance.now() > deadline)
                throw Error("Pending acknowledgements did not drain");
              await delay(1);
            }
          });
          expect(
            (await repository.getSummary("task-31"))?.tags.includes("reviewed"),
          ).toBe(!change.remove);
          // Let collection-wide readers receive the trailing change notification
          // before the next round times an already hydrated index.
          await repository.stats();
        }
      } finally {
        fixture.close();
      }
    }
    const metrics = Object.fromEntries(
      Object.entries(samples).map(([key, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return [
          key,
          {
            median: +sorted[2]!.toFixed(2),
            p95: +sorted[4]!.toFixed(2),
            samples: values.map((v) => +v.toFixed(2)),
          },
        ];
      }),
    );
    console.log(
      JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, metrics }),
    );
  },
  300_000,
);

// @vitest-environment node
import { cpus } from "node:os";
import { expect, it } from "vitest";
import { TaskNotesTaskModel } from "../src/domain/tasknotes-model";
import { SCRATCHPAD_TYPE, scratchpadPreview } from "../src/domain/scratchpad";
import { emptyViewDraft } from "../src/domain/view-document";
import { groupTaskViewRows } from "../src/domain/view-grouping";
import { tasksForViewDraft } from "../src/domain/view-preview";
import type { TaskViewExecution } from "../src/domain/view";
import { seedRecord, seedTask } from "../src/test/next-task-fixture";
import { benchmarkReplica, emptyWork, meteredTaskNotes } from "./sdk-stand-in";

const size = 10_000;
const rounds = 7;
const enabled = process.env.TASKNOTES_BENCH_INTERACTIONS === "1";
const date = "2026-11-04T12:00:00Z";

function report(name: string, samples: number[], work?: object) {
  const ordered = [...samples].sort((left, right) => left - right);
  console.log(
    JSON.stringify({
      name,
      size,
      node: process.version,
      cpu: cpus()[0]?.model,
      medianMs: +ordered[Math.floor(ordered.length / 2)]!.toFixed(2),
      samplesMs: samples.map((ms) => +ms.toFixed(2)),
      work,
    }),
  );
}

it.runIf(enabled)(
  "measures typing successive queries over 10k task bodies",
  async () => {
    const replica = benchmarkReplica();
    for (let index = 0; index < size; index++) {
      seedTask(
        replica,
        {
          title: `Task ${index}`,
          body: (
            `Ordinary note ${index}. ` + "Details to review. ".repeat(112)
          ).slice(0, 2048),
        },
        { id: `task-${index}` },
      );
    }
    let work = emptyWork();
    const { repository, close } = await meteredTaskNotes(replica, () => work);
    try {
      await repository.initialize();
      for (const mode of ["singleToken", "multiToken"] as const) {
        const samples = [];
        for (let round = 0; round <= rounds; round++) {
          work = emptyWork();
          const start = performance.now();
          for (const suffix of ["9", "99", "999", "9999"]) {
            const results = await repository.search({
              status: "all",
              search:
                mode === "multiToken" ? `ordinary note ${suffix}` : suffix,
              limit: 300,
            });
            expect(results.length).toBeGreaterThan(0);
            if (suffix === "9999")
              expect(results.map(({ task }) => task.id)).toEqual(["task-9999"]);
          }
          if (round) samples.push(performance.now() - start);
        }
        report(`search.${mode}`, samples, {
          requests: work.requests,
          responseBytes: work.responseBytes,
        });
      }
    } finally {
      close();
    }
  },
  180_000,
);

it.runIf(enabled)(
  "measures filtering, sorting and grouping 10k task rows",
  () => {
    const model = new TaskNotesTaskModel();
    const tasks = Array.from({ length: size }, (_, index) =>
      model.create(
        {
          title: `Task ${size - index}`,
          tags: [index % 5 === 0 ? "personal" : "work"],
        },
        { id: `task-${index}`, now: date },
      ),
    );
    const draft = {
      ...emptyViewDraft("obsidian-bases"),
      filter: 'note.tags.contains("work")',
      sort: [{ property: "title", direction: "asc" as const }],
    };
    const samples = { filterAndSort: [] as number[], group: [] as number[] };
    for (let round = 0; round <= rounds; round++) {
      let start = performance.now();
      const matching = tasksForViewDraft(draft, tasks)!;
      if (round) samples.filterAndSort.push(performance.now() - start);
      expect(matching).toHaveLength(8000);
      expect(matching[0]?.title).toBe("Task 1");
      const groupCount = 250;
      const execution = {
        rows: matching.map((task, index) => ({
          task,
          values: { project: index % groupCount },
        })),
        groups: Array.from({ length: groupCount }, (_, index) => ({
          values: { project: index },
          count: 32,
          summaries: {},
        })),
      } satisfies Pick<TaskViewExecution, "rows" | "groups">;
      start = performance.now();
      const groups = groupTaskViewRows(execution);
      if (round) samples.group.push(performance.now() - start);
      expect(groups).toHaveLength(groupCount);
      expect(groups.every(({ rows }) => rows.length === 32)).toBe(true);
    }
    report("tasks.filterAndSort", samples.filterAndSort);
    report("tasks.group", samples.group);
  },
);

it.runIf(enabled)(
  "measures entry and an older page over 10k Scratchpad notes",
  async () => {
    const replica = benchmarkReplica();
    for (let index = 0; index < size; index++) {
      const created = new Date(
        Date.parse(date) - index * 86_400_000,
      ).toISOString();
      seedRecord(replica, {
        path: `TaskNotes/Scratchpad/${index}.md`,
        types: [SCRATCHPAD_TYPE],
        frontmatter: {
          type: SCRATCHPAD_TYPE,
          id: `note-${index}`,
          state: index === 0 ? "active" : "converted",
          dateCreated: created,
          dateModified: created,
          title: `Note ${index}`,
        },
        body: (
          `Note ${index}\n` + "- More notes to review.\n".repeat(100)
        ).slice(0, 2048),
      });
    }
    let work = emptyWork();
    const { repository, close } = await meteredTaskNotes(replica, () => work);
    try {
      await repository.initialize({ deferTaskIndex: true });
      const samples = {
        entry: [] as number[],
        olderAndPreview: [] as number[],
      };
      for (let round = 0; round <= rounds; round++) {
        work = emptyWork();
        let start = performance.now();
        const page = await repository.listScratchFeed();
        if (round) samples.entry.push(performance.now() - start);
        expect(page.current.id).toBe("note-0");
        expect(page.items).toHaveLength(20);
        expect(page.nextCursor).toBeTruthy();
        start = performance.now();
        const older = await repository.listScratchFeed({
          cursor: page.nextCursor,
        });
        const item = older.items[0]!;
        expect(item.kind).toBe("scratchpad");
        if (item.kind !== "scratchpad") throw new Error("Expected a note");
        const preview = scratchpadPreview(item);
        if (round) samples.olderAndPreview.push(performance.now() - start);
        expect(preview).toMatch(/^Note 21/);
      }
      report("notes.entry", samples.entry, work);
      report("notes.olderAndPreview", samples.olderAndPreview);
    } finally {
      close();
    }
  },
  180_000,
);

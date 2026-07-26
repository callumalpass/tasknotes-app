import { describe, expect, it } from "vitest";

import {
  occurrenceTask,
  findMaterializedOccurrenceTask,
  materializedOccurrenceKeys,
  projectTodayTasks,
  projectUpcomingTasks,
  rollingOccurrenceDates,
  taskOccurrencesBetween,
} from "./task-occurrence";

import type { Task } from "./task";

const task: Task = {
  id: "weekly",
  path: "tasks/weekly.md",
  title: "Weekly review",
  status: "open",
  completed: false,
  archived: false,
  priority: "normal",
  scheduled: "2026-08-03T09:00",
  due: "2026-08-04T17:00",
  body: "",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  tags: ["task"],
  contexts: [],
  projects: [],
  blockedBy: [],
  recurrence: "FREQ=WEEKLY;BYDAY=MO,WE",
  completeInstances: ["2026-08-05"],
  skippedInstances: ["2026-08-10"],
  reminders: [],
  timeEntries: [],
  customProperties: {},
  revision: 1,
  frontmatter: {},
};

describe("recurring task occurrences", () => {
  it("projects every generated date and its instance state", () => {
    const occurrences = taskOccurrencesBetween(
      task,
      "2026-08-03",
      "2026-08-12",
    );
    expect(
      occurrences.map((entry) => ({
        date: entry.date,
        completed: entry.completed,
        skipped: entry.skipped,
      })),
    ).toEqual([
      { date: "2026-08-03", completed: false, skipped: false },
      { date: "2026-08-05", completed: true, skipped: false },
      { date: "2026-08-10", completed: false, skipped: true },
      { date: "2026-08-12", completed: false, skipped: false },
    ]);
  });

  it("preserves times and the scheduled-to-due offset", () => {
    const [entry] = taskOccurrencesBetween(task, "2026-08-12", "2026-08-12");
    expect(occurrenceTask(entry)).toMatchObject({
      scheduled: "2026-08-12T09:00",
      due: "2026-08-13T17:00",
      completed: false,
    });
  });

  it("keeps exact Today counts while bounding every rendered section", () => {
    const projection = projectTodayTasks(
      [
        { ...task, completeInstances: [], skippedInstances: [] },
        oneOff("today", "2026-08-05"),
        oneOff("inbox"),
      ],
      "2026-08-01",
      "2026-08-05",
      1,
    );

    expect(projection).toMatchObject({ shownCount: 3, totalCount: 4 });
    expect(projection.overdue).toHaveLength(1);
    expect(projection.today).toHaveLength(1);
    expect(projection.inbox).toHaveLength(1);
  });

  it("retains the earliest Upcoming entries and exact per-day counts", () => {
    const projection = projectUpcomingTasks(
      [task, oneOff("tomorrow", "2026-08-04"), oneOff("later", "2026-08-20")],
      "2026-08-03",
      "2026-08-12",
      2,
    );

    expect(projection).toMatchObject({ shownCount: 2, totalCount: 3 });
    expect(projection.groups.map((group) => group.date)).toEqual([
      "2026-08-04",
      "2026-08-12",
    ]);
  });

  it("lets a materialized child replace the projected parent occurrence", () => {
    const parent = {
      ...task,
      completeInstances: [],
      skippedInstances: [],
    };
    const child: Task = {
      ...oneOff("child", "2026-08-05T09:00"),
      recurrenceParent: "[[tasks/weekly]]",
      occurrenceDate: "2026-08-05",
    };
    const active = projectTodayTasks(
      [parent, child],
      "2026-08-05",
      "2026-08-05",
      10,
    );
    expect(active.today).toHaveLength(1);
    expect(active.today[0]).toMatchObject({
      key: "child",
      task: { id: "child" },
    });
    expect(active.today[0].occurrence).toBeUndefined();

    const completed = projectTodayTasks(
      [parent, { ...child, completed: true, status: "done" }],
      "2026-08-05",
      "2026-08-05",
      10,
    );
    expect(completed.totalCount).toBe(0);
  });

  it("keeps rolling materialization finite and rejects unbounded horizons", () => {
    const rolling: Task = {
      ...task,
      scheduled: "2026-08-05",
      recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
      occurrenceMaterialization: "rolling",
      occurrencePastHorizon: "P1D",
      occurrenceFutureHorizon: "P2D",
    };
    expect(rollingOccurrenceDates(rolling, new Date(2026, 7, 5))).toEqual([
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
    expect(() =>
      rollingOccurrenceDates(
        { ...rolling, occurrenceFutureHorizon: "unbounded" },
        new Date(2026, 7, 5),
      ),
    ).toThrow(/invalid_occurrence_horizon/);
  });

  it("clamps calendar-month rolling horizons at the end of the month", () => {
    const rolling: Task = {
      ...task,
      scheduled: "2026-01-31",
      recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260131",
      occurrenceMaterialization: "rolling",
      occurrencePastHorizon: "P0D",
      occurrenceFutureHorizon: "P1M",
    };
    const dates = rollingOccurrenceDates(rolling, new Date(2026, 0, 31));
    expect(dates.at(-1)).toBe("2026-02-28");
    expect(dates).toHaveLength(29);
  });

  it("refuses to choose between duplicate materialized occurrence notes", () => {
    const child = {
      ...oneOff("first-child", "2026-08-05"),
      recurrenceParent: "[[tasks/weekly]]",
      occurrenceDate: "2026-08-05",
    };
    expect(() =>
      findMaterializedOccurrenceTask(
        [task, child, { ...child, id: "second-child" }],
        task,
        "2026-08-05",
      ),
    ).toThrow(/duplicate_occurrence_note/);
  });

  it("indexes materialized identities linearly for large collections", () => {
    const count = 10_000;
    const parents = Array.from({ length: count }, (_, index) => ({
      ...oneOff(`parent-${index}`, "2026-08-05"),
      path: `tasks/parent-${index}.md`,
      recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
    }));
    const children = parents.map((parent, index) => ({
      ...oneOff(`child-${index}`, "2026-08-05"),
      recurrenceParent: `[[${parent.path.slice(0, -3)}]]`,
      occurrenceDate: "2026-08-05",
    }));

    const startedAt = performance.now();
    const keys = materializedOccurrenceKeys([...parents, ...children]);
    const elapsedMs = performance.now() - startedAt;

    expect(keys.size).toBe(count);
    expect(elapsedMs).toBeLessThan(1_000);
  });
});

function oneOff(id: string, scheduled?: string): Task {
  return {
    ...task,
    id,
    path: `tasks/${id}.md`,
    title: id,
    scheduled,
    due: undefined,
    recurrence: undefined,
    completeInstances: [],
    skippedInstances: [],
  };
}

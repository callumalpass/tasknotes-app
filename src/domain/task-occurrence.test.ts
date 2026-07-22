import { describe, expect, it } from "vitest";

import {
  occurrenceTask,
  projectTodayTasks,
  projectUpcomingTasks,
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

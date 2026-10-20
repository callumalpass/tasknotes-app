import { describe, expect, it } from "vitest";

import { summarizeToday } from "./today-summary";

import type { TaskSummary } from "./task";

const today = "2026-07-26";

describe("summarizeToday", () => {
  it("counts only tasks finished today that were planned for today", () => {
    const summary = summarizeToday(
      [
        task("scheduled", { scheduled: today, completedDate: today }),
        task("due", { due: `${today}T17:00`, completedDate: today }),
        task("late", { scheduled: "2026-07-25", completedDate: today }),
        task("earlier", { scheduled: today, completedDate: "2026-07-25" }),
        task("archived", {
          scheduled: today,
          completedDate: today,
          archived: true,
        }),
        task("open", { scheduled: today, completed: false }),
      ],
      today,
    );

    expect(summary.completedToday).toBe(2);
  });

  it("counts today's completed repeating instance once", () => {
    const series = task("series", {
      completed: false,
      recurrence: "FREQ=DAILY",
      scheduled: "2026-07-27",
      completeInstances: [today],
    });
    expect(summarizeToday([series], today).completedToday).toBe(1);

    // A materialized occurrence note represents today's instance itself.
    const occurrence = task("occurrence", {
      recurrenceParent: "[[tasks/series]]",
      occurrenceDate: today,
      scheduled: today,
      completedDate: today,
    });
    expect(summarizeToday([series, occurrence], today).completedToday).toBe(1);
  });

  it("finds the earliest open task or repeating occurrence after today", () => {
    const weekly = task("weekly", {
      completed: false,
      recurrence: "FREQ=DAILY;INTERVAL=3",
      scheduled: today,
      completeInstances: [today],
    });
    const nextWeek = task("next-week", {
      completed: false,
      scheduled: "2026-08-02",
    });
    const tomorrowDue = task("tomorrow", {
      completed: false,
      due: "2026-07-27",
    });
    const finished = task("finished", { scheduled: "2026-07-27" });

    expect(
      summarizeToday([weekly, nextWeek, finished, tomorrowDue], today).next
        ?.task.id,
    ).toBe("tomorrow");
    const next = summarizeToday([weekly, nextWeek], today).next;
    expect([next?.task.id, next?.date]).toEqual(["weekly", "2026-07-29"]);
    expect(summarizeToday([finished], today).next).toBeUndefined();
  });
});

function task(id: string, patch: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    path: `tasks/${id}.md`,
    title: id,
    status: patch.completed === false ? "open" : "done",
    completed: true,
    archived: false,
    priority: "normal",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    tags: [],
    contexts: [],
    projects: [],
    attachments: [],
    blockedBy: [],
    completeInstances: [],
    skippedInstances: [],
    reminders: [],
    timeEntries: [],
    customProperties: {},
    frontmatter: {},
    ...patch,
  } as TaskSummary;
}

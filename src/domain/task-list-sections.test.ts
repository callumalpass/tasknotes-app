import { describe, expect, it } from "vitest";

import { sectionTaskViewRows } from "./task-list-sections";

import type { Task } from "./task";
import type { TaskViewRow } from "./view";

describe("sectionTaskViewRows", () => {
  it("adds a presentation hierarchy while preserving row order", () => {
    const rows = [
      row("anytime-1"),
      row("today-1", { scheduled: "2026-07-26T09:00" }),
      row("overdue-1", { due: "2026-07-25" }),
      row("today-2", { due: "2026-07-26" }),
      row("later-1", { scheduled: "2026-07-27" }),
      row("anytime-2"),
    ];

    expect(sectionTaskViewRows(rows, "day", "2026-07-26")).toEqual([
      {
        key: "overdue",
        label: "Overdue",
        rows: [rows[2]],
      },
      {
        key: "today",
        label: "Today",
        rows: [rows[1], rows[3]],
      },
      {
        key: "anytime",
        label: "Anytime",
        rows: [rows[0], rows[5]],
      },
      {
        key: "later",
        label: "Later",
        rows: [rows[4]],
      },
    ]);
  });

  it("does no work when the view does not opt into sections", () => {
    expect(sectionTaskViewRows([row("task")], undefined)).toEqual([]);
  });

  it("sections 10,000 rows within the list interaction budget", () => {
    const rows = Array.from({ length: 10_000 }, (_, index) =>
      row(`task-${index}`, {
        scheduled:
          index % 3 === 0
            ? "2026-07-25"
            : index % 3 === 1
              ? "2026-07-26"
              : undefined,
      }),
    );
    const startedAt = performance.now();
    const sections = sectionTaskViewRows(rows, "day", "2026-07-26");
    const elapsed = performance.now() - startedAt;

    expect(
      sections.reduce((count, section) => count + section.rows.length, 0),
    ).toBe(10_000);
    expect(elapsed).toBeLessThan(100);
    console.info(`day list hierarchy: 10,000 rows in ${elapsed.toFixed(1)}ms`);
  });
});

function row(id: string, patch: Partial<Task> = {}): TaskViewRow {
  return {
    values: {},
    task: {
      id,
      path: `tasks/${id}.md`,
      title: id,
      status: "open",
      completed: false,
      archived: false,
      priority: "normal",
      body: "",
      createdAt: "2026-07-26T00:00:00Z",
      updatedAt: "2026-07-26T00:00:00Z",
      tags: [],
      contexts: [],
      projects: [],
      blockedBy: [],
      completeInstances: [],
      skippedInstances: [],
      reminders: [],
      timeEntries: [],
      customProperties: {},
      revision: 1,
      frontmatter: {},
      ...patch,
    },
  };
}

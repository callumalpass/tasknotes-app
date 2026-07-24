import { describe, expect, it } from "vitest";

import { calendarEvents } from "./calendar-events";

import type { Task } from "./task";
import type { TaskViewExecution } from "./view";

describe("calendar task projection", () => {
  it("uses the saved view's scheduled and due date options", () => {
    const task = oneOff();
    const scheduledOnly = calendarEvents(
      execution(task, {
        showScheduled: true,
        showDue: false,
      }),
      new Date(2026, 6, 20),
      new Date(2026, 6, 31),
      [task],
    );
    expect([...scheduledOnly.keys()]).toEqual(["2026-07-24"]);

    const dueOnly = calendarEvents(
      execution(task, {
        showScheduled: false,
        showDue: true,
      }),
      new Date(2026, 6, 20),
      new Date(2026, 6, 31),
      [task],
    );
    expect([...dueOnly.keys()]).toEqual(["2026-07-25"]);
  });

  it("virtualizes recurring instances and honors completed-instance options", () => {
    const task = recurring();
    const open = calendarEvents(
      execution(task, {
        showScheduled: true,
        showDue: false,
        showRecurring: true,
      }),
      new Date(2026, 7, 3),
      new Date(2026, 7, 12),
      [task],
    );
    expect([...open.keys()]).toEqual(["2026-08-03", "2026-08-12"]);

    const withHistory = calendarEvents(
      execution(task, {
        showScheduled: true,
        showDue: false,
        showRecurring: true,
        showCompletedRecurringInstances: true,
        showSkippedRecurringInstances: true,
      }),
      new Date(2026, 7, 3),
      new Date(2026, 7, 12),
      [task],
    );
    expect([...withHistory.keys()]).toEqual([
      "2026-08-03",
      "2026-08-05",
      "2026-08-10",
      "2026-08-12",
    ]);
  });
});

function execution(
  task: Task,
  options: Record<string, unknown>,
): TaskViewExecution {
  const source = {
    path: "views/tasks.base",
    format: "obsidian.base",
    revision: "one",
    writable: true,
  };
  return {
    view: {
      key: "views/tasks.base#calendar",
      documentId: "tasks",
      documentName: "Tasks",
      id: "calendar",
      name: "Calendar",
      properties: [],
      source,
      presentation: {
        type: "tasknotes.calendar",
        mappings: {},
        options,
      },
    },
    rows: [{ task, values: {} }],
    totalCount: 1,
    hasMore: false,
    groups: [],
  };
}

function oneOff(): Task {
  return {
    ...baseTask(),
    id: "one",
    path: "tasks/one.md",
    scheduled: "2026-07-24T09:00",
    due: "2026-07-25",
  };
}

function recurring(): Task {
  return {
    ...baseTask(),
    id: "weekly",
    path: "tasks/weekly.md",
    scheduled: "2026-08-03T09:00",
    recurrence: "FREQ=WEEKLY;BYDAY=MO,WE",
    completeInstances: ["2026-08-05"],
    skippedInstances: ["2026-08-10"],
  };
}

function baseTask(): Task {
  return {
    id: "task",
    path: "tasks/task.md",
    title: "Calendar task",
    status: "open",
    completed: false,
    archived: false,
    priority: "normal",
    body: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    tags: ["task"],
    contexts: [],
    projects: [],
    completeInstances: [],
    skippedInstances: [],
    reminders: [],
    timeEntries: [],
    customProperties: {},
    revision: 1,
    frontmatter: {},
  };
}

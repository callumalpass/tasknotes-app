import { expect, it } from "vitest";

import { calendarEvents } from "../domain/calendar-events";

import type { Task } from "../domain/task";
import type { TaskViewExecution } from "../domain/view";

it("suppresses a projected calendar occurrence when its child is filtered out", () => {
  const parent = task({
    id: "parent",
    path: "tasks/parent.md",
    scheduled: "2026-08-05",
    recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
  });
  const child = task({
    id: "child",
    path: "tasks/child.md",
    status: "done",
    completed: true,
    scheduled: "2026-08-05",
    recurrenceParent: "[[tasks/parent]]",
    occurrenceDate: "2026-08-05",
  });
  const execution: TaskViewExecution = {
    view: {
      key: "views/calendar.base#open",
      documentId: "calendar",
      documentName: "calendar.base",
      id: "open",
      name: "Open dates",
      properties: [],
      source: {
        path: "views/calendar.base",
        format: "obsidian.base",
        revision: "1",
        writable: false,
      },
      presentation: {
        type: "tasknotes.calendar",
        mappings: {},
        options: { showScheduled: true, showDue: false },
      },
    },
    rows: [{ task: parent, values: {} }],
    totalCount: 1,
    hasMore: false,
    groups: [],
  };

  const events = calendarEvents(
    execution,
    new Date(2026, 7, 5),
    new Date(2026, 7, 5),
    [parent, child],
  );

  expect(events.get("2026-08-05")).toBeUndefined();
});

function task(overrides: Partial<Task>): Task {
  return {
    id: "task",
    path: "tasks/task.md",
    title: "Task",
    status: "open",
    completed: false,
    archived: false,
    priority: "normal",
    body: "",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    tags: [],
    contexts: [],
    projects: [],
    completeInstances: [],
    skippedInstances: [],
    reminders: [],
    timeEntries: [],
    customProperties: {},
    revision: 1,
    frontmatter: {},
    ...overrides,
  };
}

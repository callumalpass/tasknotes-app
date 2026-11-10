import { describe, expect, it } from "vitest";

import { taskRowRelations } from "./task-row-relations";

import type { TaskSummary } from "./task";

function task(id: string, patch: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    path: `Tasks/${id}.md`,
    title: id,
    status: "open",
    completed: false,
    archived: false,
    priority: "normal",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
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
    revision: 1,
    frontmatter: {},
    ...patch,
  };
}

describe("taskRowRelations", () => {
  it("counts the tasks that name a task as their project", () => {
    const relations = taskRowRelations([
      task("parent"),
      task("one", { projects: ["[[parent]]"] }),
      task("two", { projects: ["[[Tasks/parent]]"], completed: true }),
      task("three", { projects: ["[Parent](Tasks/parent.md)"] }),
      task("elsewhere", { projects: ["[[Some note]]"] }),
    ]);
    expect(relations).toEqual({
      parent: { subtasks: 3, subtasksDone: 1, blockedBy: 0 },
    });
  });

  it("leaves archived subtasks out and counts a repeated link once", () => {
    const relations = taskRowRelations([
      task("parent"),
      task("old", { projects: ["[[parent]]"], archived: true }),
      task("twice", { projects: ["[[parent]]", "[[Tasks/parent]]"] }),
      task("self", { projects: ["[[self]]"] }),
    ]);
    expect(relations).toEqual({
      parent: { subtasks: 1, subtasksDone: 0, blockedBy: 0 },
    });
  });

  it("marks a task blocked only while a dependency is still open", () => {
    const relations = taskRowRelations([
      task("open"),
      task("done", { completed: true }),
      task("shelved", { archived: true }),
      task("waiting", {
        blockedBy: [
          { uid: "open", reltype: "FINISHTOSTART" },
          { uid: "[[done]]", reltype: "FINISHTOSTART" },
          { uid: "shelved", reltype: "FINISHTOSTART" },
          { uid: "[[missing]]", reltype: "FINISHTOSTART" },
        ],
      }),
      task("clear", { blockedBy: [{ uid: "done", reltype: "FINISHTOSTART" }] }),
      task("finished", {
        completed: true,
        blockedBy: [{ uid: "open", reltype: "FINISHTOSTART" }],
      }),
    ]);
    expect(relations).toEqual({
      waiting: { subtasks: 0, subtasksDone: 0, blockedBy: 1 },
    });
  });
});

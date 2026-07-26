import { describe, expect, it } from "vitest";

import {
  kanbanMoveInput,
  kanbanPropertyName,
  kanbanPropertyRole,
} from "./kanban";

import type { Task } from "./task";

describe("Kanban moves", () => {
  it("maps canonical and Obsidian status properties to task updates", () => {
    expect(kanbanMoveInput(task(), "status", "done")).toEqual({
      status: "done",
    });
    expect(kanbanMoveInput(task(), "note.status", "in-progress")).toEqual({
      status: "in-progress",
    });
  });

  it("uses the collection's configured frontmatter field names", () => {
    const fieldMapping = {
      status: "state",
      timeEstimate: "estimate",
      recurrence: "repeat",
    };
    expect(
      kanbanMoveInput(task(), "note.state", "in-progress", fieldMapping),
    ).toEqual({ status: "in-progress" });
    expect(kanbanMoveInput(task(), "status", "blocked", fieldMapping)).toEqual({
      customProperties: {
        owner: "Callum",
        status: "blocked",
      },
    });
    expect(kanbanMoveInput(task(), "estimate", 30, fieldMapping)).toEqual({
      timeEstimate: 30,
    });
    expect(kanbanPropertyRole("note.state", fieldMapping)).toBe("status");
    expect(kanbanPropertyRole("status", fieldMapping)).toBe("custom");
    expect(
      kanbanMoveInput(task(), "repeat", "weekly", fieldMapping),
    ).toBeNull();
  });

  it("preserves unrelated custom properties and removes an empty destination", () => {
    expect(kanbanMoveInput(task(), "lane", "review")).toEqual({
      customProperties: { owner: "Callum", lane: "review" },
    });
    expect(kanbanMoveInput(task(), "note.lane", null)).toEqual({
      customProperties: { owner: "Callum" },
    });
  });

  it("normalizes list fields and rejects computed destinations", () => {
    expect(kanbanMoveInput(task(), "projects", "mdbase")).toEqual({
      projects: ["mdbase"],
    });
    expect(kanbanMoveInput(task(), "tags", ["work", "mobile"])).toEqual({
      tags: ["work", "mobile"],
    });
    expect(kanbanPropertyName("formula.progress")).toBeNull();
    expect(kanbanMoveInput(task(), "file.folder", "archive")).toBeNull();
  });
});

function task(): Task {
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
    blockedBy: [],
    completeInstances: [],
    skippedInstances: [],
    reminders: [],
    timeEntries: [],
    customProperties: { owner: "Callum" },
    revision: 1,
    frontmatter: {},
  };
}

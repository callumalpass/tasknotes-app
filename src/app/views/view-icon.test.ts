import { describe, expect, it } from "vitest";

import {
  TASKNOTES_DEFAULT_VIEW_SOURCE_NAME,
  taskNotesViewSourcePath,
} from "../../domain/default-view-source";
import type { TaskView } from "../../domain/view";
import { taskViewIcon } from "./view-icon";

function view(
  name: string,
  type: string,
  options: Record<string, unknown> = {},
  starter = true,
): TaskView {
  return {
    key: `${starter ? "starter" : "mine"}:${name}`,
    documentId: starter ? TASKNOTES_DEFAULT_VIEW_SOURCE_NAME : "mine",
    documentName: starter ? "TaskNotes" : "Mine",
    id: name.toLowerCase(),
    name,
    properties: [],
    source: {
      path: starter
        ? taskNotesViewSourcePath(TASKNOTES_DEFAULT_VIEW_SOURCE_NAME)
        : "Views/mine.md",
      format: "mdbase",
      revision: "r1",
      writable: true,
    },
    presentation: { type, mappings: {}, options },
  };
}

describe("taskViewIcon", () => {
  it("gives every starter destination its own glyph", () => {
    const starters = [
      view("Today", "tasknotes.task-list", { sections: "day" }),
      view("Upcoming", "tasknotes.calendar", { calendarView: "listWeek" }),
      view("Calendar", "tasknotes.calendar", { calendarView: "dayGridMonth" }),
      view("Projects", "tasknotes.task-list", { create: false }),
      view("Archive", "tasknotes.task-list", { create: false }),
    ];
    expect(new Set(starters.map(taskViewIcon)).size).toBe(starters.length);
  });

  it("follows layout, not name, for views outside the starter source", () => {
    const plain = taskViewIcon(
      view("Someday", "tasknotes.task-list", {}, false),
    );
    expect(
      taskViewIcon(view("Archive", "tasknotes.task-list", {}, false)),
    ).toBe(plain);
    expect(
      taskViewIcon(view("Archive", "tasknotes.kanban", {}, false)),
    ).not.toBe(plain);
    expect(
      taskViewIcon(
        view("My day", "tasknotes.task-list", { sections: "day" }, false),
      ),
    ).toBe(
      taskViewIcon(view("Today", "tasknotes.task-list", { sections: "day" })),
    );
  });
});

import { taskViewKey } from "./view";

import type { TaskView, TaskViewDocument } from "./view";

const SOURCE = {
  path: "tasknotes://default-views",
  format: "tasknotes.builtin",
  revision: "1",
  writable: false,
} as const;

export const TODAY_VIEW_KEY = taskViewKey(SOURCE.path, "today");
export const UPCOMING_VIEW_KEY = taskViewKey(SOURCE.path, "upcoming");
export const DEFAULT_NAVIGATION_VIEW_KEYS = [
  TODAY_VIEW_KEY,
  UPCOMING_VIEW_KEY,
] as const;

export function taskNotesDefaultViewDocument(): TaskViewDocument {
  return {
    id: "tasknotes.default-views",
    name: "TaskNotes",
    source: { ...SOURCE },
    views: [
      defaultView("today", "Today", "tasknotes.today"),
      defaultView("upcoming", "Upcoming", "tasknotes.upcoming"),
    ],
  };
}

export function isTaskNotesDefaultView(view: TaskView): boolean {
  return view.source.format === SOURCE.format;
}

function defaultView(id: string, name: string, type: string): TaskView {
  return {
    key: taskViewKey(SOURCE.path, id),
    documentId: "tasknotes.default-views",
    documentName: "TaskNotes",
    id,
    name,
    properties: [],
    source: { ...SOURCE },
    presentation: {
      type,
      fallback: "tasknotes.task-list",
      mappings: {},
      options: {},
    },
  };
}

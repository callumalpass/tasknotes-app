export type ViewRenderer =
  | "tasknotes.task-list"
  | "tasknotes.kanban"
  | "tasknotes.calendar"
  | "tasknotes.mini-calendar";

const OBSIDIAN_RENDERERS: Record<string, ViewRenderer> = {
  tasknotesTaskList: "tasknotes.task-list",
  tasknotesKanban: "tasknotes.kanban",
  tasknotesCalendar: "tasknotes.calendar",
  tasknotesMiniCalendar: "tasknotes.mini-calendar",
};

export function normalizePresentationType(value: string): string {
  return OBSIDIAN_RENDERERS[value] ?? value;
}

export function editableRenderer(value: string): ViewRenderer {
  const normalized = normalizePresentationType(value);
  if (
    normalized === "tasknotes.kanban" ||
    normalized === "tasknotes.calendar" ||
    normalized === "tasknotes.mini-calendar"
  )
    return normalized;
  return "tasknotes.task-list";
}

export function obsidianRenderer(value: ViewRenderer): string {
  if (value === "tasknotes.kanban") return "tasknotesKanban";
  if (value === "tasknotes.calendar") return "tasknotesCalendar";
  if (value === "tasknotes.mini-calendar") return "tasknotesMiniCalendar";
  return "tasknotesTaskList";
}

export function isCalendarRenderer(value: ViewRenderer): boolean {
  return value === "tasknotes.calendar" || value === "tasknotes.mini-calendar";
}

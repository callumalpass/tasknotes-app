export type ViewRenderer =
  | "tasknotes.task-list"
  | "tasknotes.kanban"
  | "tasknotes.calendar"
  | "tasknotes.mini-calendar"
  | "tasknotes.projects"
  | "tasknotes.planner";

const OBSIDIAN_RENDERERS: Record<string, ViewRenderer> = {
  tasknotesTaskList: "tasknotes.task-list",
  tasknotesKanban: "tasknotes.kanban",
  tasknotesCalendar: "tasknotes.calendar",
  tasknotesMiniCalendar: "tasknotes.mini-calendar",
  tasknotesProjects: "tasknotes.projects",
  tasknotesPlanner: "tasknotes.planner",
};

export function normalizePresentationType(value: string): string {
  return OBSIDIAN_RENDERERS[value] ?? value;
}

export function editableRenderer(value: string): ViewRenderer {
  const normalized = normalizePresentationType(value);
  if (
    normalized === "tasknotes.kanban" ||
    normalized === "tasknotes.calendar" ||
    normalized === "tasknotes.mini-calendar" ||
    normalized === "tasknotes.planner"
  )
    return normalized;
  return "tasknotes.task-list";
}

export function obsidianRenderer(value: ViewRenderer): string {
  if (value === "tasknotes.kanban") return "tasknotesKanban";
  if (value === "tasknotes.calendar") return "tasknotesCalendar";
  if (value === "tasknotes.mini-calendar") return "tasknotesMiniCalendar";
  if (value === "tasknotes.planner") return "tasknotesPlanner";
  return "tasknotesTaskList";
}

export function isCalendarRenderer(value: ViewRenderer): boolean {
  return value === "tasknotes.calendar" || value === "tasknotes.mini-calendar";
}

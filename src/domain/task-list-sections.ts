import { setTaskDate, shiftTaskDate } from "./task-date-actions";
import { taskDatePart, todayString } from "./task";

import type { Task, UpdateTaskInput } from "./task";
import type { TaskViewRow } from "./view";

export type TaskListSectionMode = "day";

export type TaskListSectionKey = "overdue" | "today" | "anytime" | "later";

export interface TaskListSection {
  key: TaskListSectionKey;
  label: string;
  rows: TaskViewRow[];
}

/**
 * Apply optional presentation hierarchy without changing provider query
 * semantics. Row order inside each section remains provider-owned.
 */
export function sectionTaskViewRows(
  rows: readonly TaskViewRow[],
  mode: unknown,
  today = todayString(),
  options: { includeEmpty?: boolean } = {},
): TaskListSection[] {
  if (mode !== "day") return [];
  const sections: TaskListSection[] = [
    { key: "overdue", label: "Overdue", rows: [] },
    { key: "today", label: "Today", rows: [] },
    { key: "anytime", label: "Anytime", rows: [] },
    { key: "later", label: "Later", rows: [] },
  ];
  const byKey = new Map(sections.map((section) => [section.key, section]));
  for (const row of rows) {
    const date = taskDatePart(row.task.scheduled ?? row.task.due);
    const key = !date
      ? "anytime"
      : date < today
        ? "overdue"
        : date === today
          ? "today"
          : "later";
    byKey.get(key)?.rows.push(row);
  }
  return options.includeEmpty
    ? sections
    : sections.filter((section) => section.rows.length);
}

/**
 * Return the task mutation that makes the built-in day classifier place a
 * task in the requested section. This belongs to the reusable section type,
 * not to any particular saved view such as Today.
 */
export function taskListSectionMoveInput(
  task: Task,
  mode: unknown,
  destination: string,
  today = todayString(),
): UpdateTaskInput | null {
  if (mode !== "day" || !isSectionKey(destination)) return null;
  if (destination === "anytime") return { scheduled: null, due: null };

  const targetDate =
    destination === "today"
      ? today
      : shiftTaskDate(today, destination === "overdue" ? -1 : 1);
  const field = task.scheduled ? "scheduled" : task.due ? "due" : "scheduled";
  const current = task[field];
  return { [field]: setTaskDate(current, targetDate) };
}

function isSectionKey(value: string): value is TaskListSectionKey {
  return ["overdue", "today", "anytime", "later"].includes(value);
}

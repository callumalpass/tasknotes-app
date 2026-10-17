import { setTaskDate, shiftTaskDate } from "./task-date-actions";
import { taskDatePart, todayString } from "./task";

import type { CreateTaskInput, TaskSummary, UpdateTaskInput } from "./task";
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
  // Today leads so a long overdue backlog cannot push today's work below
  // the fold; overdue work stays expanded directly beneath it.
  const sections: TaskListSection[] = [
    { key: "today", label: "Today", rows: [] },
    { key: "overdue", label: "Overdue", rows: [] },
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
  task: TaskSummary,
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

/**
 * Updates that bring rows onto today with the same meaning as the `t`
 * shortcut and the Schedule today action: Scheduled moves to today, keeping
 * any time, and Due stays the deadline the person recorded. A row overdue
 * only by Due therefore gains today's Scheduled date and keeps its overdue
 * Due label. Each update carries the input that restores it.
 */
export function scheduleRowsTodayUpdates(
  rows: readonly TaskViewRow[],
  today = todayString(),
): { id: string; input: UpdateTaskInput; undo: UpdateTaskInput }[] {
  return rows
    .filter(({ task }) => !task.completed)
    .map(({ task }) => ({
      id: task.id,
      input: { scheduled: setTaskDate(task.scheduled, today) },
      undo: { scheduled: task.scheduled ?? null },
    }));
}

/**
 * "Add to Today" files a new task under Today. The Today view also lists
 * undated tasks, so its filter implies no date; without one the task would be
 * undated and land under Anytime. A date the view (or capture context)
 * already sets is kept, and a date typed in capture still wins.
 */
export function todayCaptureDefaults(
  defaults: Partial<CreateTaskInput>,
  today = todayString(),
): Partial<CreateTaskInput> {
  return defaults.scheduled || defaults.due
    ? defaults
    : { ...defaults, scheduled: today };
}

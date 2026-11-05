import {
  rescheduleInput,
  setTaskDate,
  shiftTaskDate,
} from "./task-date-actions";
import { taskDatePart, taskDayStanding, todayString } from "./task";
import { compareOverdueTasks } from "./overdue-order";

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
 * semantics. Overdue is chronological unless a saved sort owns the order.
 */
export function sectionTaskViewRows(
  rows: readonly TaskViewRow[],
  mode: unknown,
  today = todayString(),
  options: { includeEmpty?: boolean; preserveOrder?: boolean } = {},
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
    byKey.get(taskDayStanding(row.task, today))?.rows.push(row);
  }
  if (!options.preserveOrder) {
    byKey
      .get("overdue")
      ?.rows.sort((left, right) => compareOverdueTasks(left.task, right.task));
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
  const input = { [field]: setTaskDate(task[field], targetDate) };
  // A missed deadline would keep the task overdue wherever it was dropped.
  const due = taskDatePart(task.due);
  return destination !== "overdue" && due && due < today
    ? { ...input, due: setTaskDate(task.due, targetDate) }
    : input;
}

/** How many rows would have a missed deadline moved along with their plan. */
export function missedDeadlineCount(
  rows: readonly TaskViewRow[],
  today = todayString(),
): number {
  return rows.filter(({ task }) => {
    const due = taskDatePart(task.due);
    return !task.completed && due && due < today;
  }).length;
}

function isSectionKey(value: string): value is TaskListSectionKey {
  return ["overdue", "today", "anytime", "later"].includes(value);
}

/**
 * Updates that bring rows onto today with the same meaning as the `t`
 * shortcut and the Schedule today action: Scheduled moves to today, keeping
 * any time, and a missed Due moves with it unless `keepDeadlines` is set.
 * Each update carries the input that restores it.
 */
export function scheduleRowsTodayUpdates(
  rows: readonly TaskViewRow[],
  date = todayString(),
  today = date,
  keepDeadlines = false,
): { id: string; input: UpdateTaskInput; undo: UpdateTaskInput }[] {
  return rows
    .filter(({ task }) => !task.completed)
    .map(({ task }) => {
      const { due, ...scheduled } = rescheduleInput(
        task,
        date,
        today,
        !keepDeadlines,
      );
      const input =
        due === undefined || keepDeadlines ? scheduled : { ...scheduled, due };
      return {
        id: task.id,
        input,
        undo: {
          scheduled: task.scheduled ?? null,
          ...("due" in input ? { due: task.due ?? null } : {}),
        },
      };
    });
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

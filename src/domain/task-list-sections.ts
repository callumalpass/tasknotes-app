import { taskDatePart, todayString } from "./task";

import type { TaskViewRow } from "./view";

export type TaskListSectionMode = "day";

export interface TaskListSection {
  key: "overdue" | "today" | "anytime" | "later";
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
  return sections.filter((section) => section.rows.length);
}

import { linkLabel, linkTarget } from "./completion";
import type { TaskSummary } from "./task";

export interface ProjectShortcut {
  label: string;
  count: number;
}

/** A project's name as lists and the Projects view show it. */
export function projectLabel(value: string): string {
  return linkLabel(value) ?? linkTarget(value).split("/").at(-1) ?? value;
}

/** The busiest projects in name order, so a capture never reshuffles them. */
export function projectShortcuts(
  tasks: Iterable<Pick<TaskSummary, "completed" | "archived" | "projects">>,
  limit = 6,
): ProjectShortcut[] {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.completed || task.archived) continue;
    for (const value of task.projects) {
      const label = projectLabel(value);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label),
    )
    .slice(0, limit)
    .sort((left, right) => left.label.localeCompare(right.label));
}

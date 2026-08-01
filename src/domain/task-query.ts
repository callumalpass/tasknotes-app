import type { Task, TaskListQuery } from "./task";

export function compareTasks(left: Task, right: Task): number {
  if (left.completed !== right.completed) return left.completed ? 1 : -1;
  const leftDate = left.scheduled ?? left.due;
  const rightDate = right.scheduled ?? right.due;
  if (leftDate !== rightDate) {
    if (!leftDate) return 1;
    if (!rightDate) return -1;
    return leftDate.localeCompare(rightDate);
  }
  const priorities: Record<string, number> = { high: 0, normal: 1, low: 2 };
  const priority =
    (priorities[left.priority] ?? 3) - (priorities[right.priority] ?? 3);
  if (priority) return priority;
  const updated = right.updatedAt.localeCompare(left.updatedAt);
  return updated || left.path.localeCompare(right.path);
}

export function matchesArchiveFilter(
  task: Task,
  query: TaskListQuery,
): boolean {
  const filter = query.archived ?? "exclude";
  return (
    filter === "include" || (filter === "only" ? task.archived : !task.archived)
  );
}

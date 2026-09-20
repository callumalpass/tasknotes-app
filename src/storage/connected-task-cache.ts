import { taskRelationships } from "../domain/task-relationships";

import type { Task, TaskStats } from "../domain/task";
import type { TaskView } from "../domain/view";

type CachedTask = { task: Task };

export function connectedTaskRelationships(
  cached: Iterable<CachedTask>,
  id: string,
) {
  const tasks = [...cached].map(({ task }) => task);
  const current = tasks.find((task) => task.id === id);
  if (!current) throw new Error("Task not found.");
  return taskRelationships(current, tasks);
}

export function connectedTaskStats(cached: Iterable<CachedTask>): TaskStats {
  let archived = 0;
  let completed = 0;
  let open = 0;
  for (const { task } of cached) {
    if (task.archived) archived += 1;
    else if (task.completed) completed += 1;
    else open += 1;
  }
  return {
    total: open + completed,
    open,
    completed,
    archived,
  };
}

export function sameConnectedTaskDocument(left: Task, right: Task): boolean {
  return (
    left.path === right.path &&
    left.body === right.body &&
    JSON.stringify(left.frontmatter) === JSON.stringify(right.frontmatter)
  );
}

export function connectedViewExecutionKey(view: TaskView): string {
  return `${view.key}:${view.source.revision}`;
}

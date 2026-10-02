import { taskRelationships } from "../domain/task-relationships";
import { taskStats } from "../domain/task-query";

import type { TaskSummary, TaskStats } from "../domain/task";
import type { TaskView } from "../domain/view";

type CachedTask = { task: TaskSummary };

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
  return taskStats(
    (function* () {
      for (const { task } of cached) yield task;
    })(),
  );
}

export function sameConnectedTaskMetadata(
  left: TaskSummary,
  right: TaskSummary,
): boolean {
  return (
    left.path === right.path &&
    JSON.stringify(left.frontmatter) === JSON.stringify(right.frontmatter)
  );
}

export function connectedViewExecutionKey(view: TaskView): string {
  return `${view.key}:${view.source.revision}`;
}

import { taskRelationships } from "../domain/task-relationships";
import { compareTasks, matchesArchiveFilter } from "../domain/task-query";

import type { Task, TaskListQuery, TaskStats } from "../domain/task";
import type { TaskView } from "../domain/view";

type CachedTask = { task: Task };

export function listConnectedTasks(
  cached: Iterable<CachedTask>,
  query: TaskListQuery = {},
): Task[] {
  const tokens = (query.search ?? "")
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return [...cached]
    .map(({ task }) => task)
    .filter((task) => {
      if (!matchesArchiveFilter(task, query)) return false;
      if (query.status === "completed" && !task.completed) return false;
      if (
        query.status !== "completed" &&
        query.status !== "all" &&
        task.completed
      )
        return false;
      const searchable = [
        task.title,
        task.body,
        ...task.tags,
        ...task.contexts,
        ...task.projects,
        ...task.attachments,
      ]
        .join("\n")
        .toLocaleLowerCase();
      return tokens.every((token) => searchable.includes(token));
    })
    .sort(compareTasks)
    .slice(0, query.limit ?? 500);
}

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

export function connectedTaskSignature(task: Task): string {
  return JSON.stringify([task.path, task.frontmatter, task.body]);
}

export function connectedViewExecutionKey(view: TaskView): string {
  return `${view.key}:${view.source.revision}`;
}

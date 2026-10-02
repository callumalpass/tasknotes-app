import type { TaskSummary, TaskListQuery, TaskStats } from "./task";

export const DEFAULT_TASK_QUERY_LIMIT = 500;

/** AND tokens may match independently across metadata and authority body evidence. */
export function taskSearchTokens(search?: string): string[] {
  return [
    ...new Set(
      (search ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean),
    ),
  ];
}

export function taskSearchMetadata(task: TaskSummary): string {
  return [
    task.title,
    ...task.tags,
    ...task.contexts,
    ...task.projects,
    ...task.attachments,
  ]
    .join("\n")
    .toLowerCase();
}

/** Select from the domain order, retaining Array.slice limit semantics. */
export function selectTaskSummaries(
  ordered: readonly TaskSummary[],
  query: TaskListQuery = {},
  matchesToken: (task: TaskSummary, token: string) => boolean = (task, token) =>
    taskSearchMetadata(task).includes(token),
  paths?: ReadonlySet<string>,
): TaskSummary[] {
  const limit = query.limit ?? DEFAULT_TASK_QUERY_LIMIT;
  if (limit === 0) return [];
  const tokens = taskSearchTokens(query.search);
  const results: TaskSummary[] = [];
  for (const task of ordered) {
    if (paths && !paths.has(task.path)) continue;
    if (!matchesArchiveFilter(task, query)) continue;
    if (
      query.status === "completed"
        ? !task.completed
        : query.status !== "all" && task.completed
    )
      continue;
    if (!tokens.every((token) => matchesToken(task, token))) continue;
    results.push(task);
    if (limit > 0 && results.length >= limit) break;
  }
  return results.slice(0, limit);
}

/** Archived tasks occupy their own bucket, outside the active total. */
export function taskStats(tasks: Iterable<TaskSummary>): TaskStats {
  let archived = 0;
  let completed = 0;
  let open = 0;
  for (const task of tasks) {
    if (task.archived) archived++;
    else if (task.completed) completed++;
    else open++;
  }
  return { total: open + completed, open, completed, archived };
}

export function compareTasks(left: TaskSummary, right: TaskSummary): number {
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
  task: TaskSummary,
  query: TaskListQuery,
): boolean {
  const filter = query.archived ?? "exclude";
  return (
    filter === "include" || (filter === "only" ? task.archived : !task.archived)
  );
}

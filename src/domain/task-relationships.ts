import { linkTarget, recordMatchesLink } from "./completion";

import type { Task, TaskDependency } from "./task";

export interface ResolvedTaskDependency {
  dependency: TaskDependency;
  task?: Task;
}

export interface TaskRelationships {
  blockedBy: ResolvedTaskDependency[];
  blocking: Task[];
  subtasks: Task[];
  projectTasks: Task[];
}

/**
 * Builds relationship indexes in one pass. `blockedBy` and `projects` are the
 * only persisted edges; blocking tasks and subtasks are their inverses.
 */
export function taskRelationships(
  current: Task,
  tasks: readonly Task[],
): TaskRelationships {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const taskByPath = new Map<string, Task>();
  for (const task of tasks) {
    const normalized = normalizeLinkTarget(task.path);
    taskByPath.set(normalized, task);
    const basename = normalized.split("/").at(-1);
    if (basename && !taskByPath.has(basename)) taskByPath.set(basename, task);
  }
  const resolve = (value: string) =>
    taskById.get(value) ?? taskByPath.get(normalizeLinkTarget(value));

  const blockedBy = (current.blockedBy ?? []).map((dependency) => ({
    dependency,
    task: resolve(dependency.uid),
  }));
  const blocking: Task[] = [];
  const subtasks: Task[] = [];

  for (const candidate of tasks) {
    if (candidate.id === current.id) continue;
    if (
      (candidate.blockedBy ?? []).some(
        (dependency) =>
          dependency.uid === current.id ||
          recordMatchesLink(current.path, dependency.uid),
      )
    )
      blocking.push(candidate);
    if (
      (candidate.projects ?? []).some((project) =>
        recordMatchesLink(current.path, project),
      )
    )
      subtasks.push(candidate);
  }

  return {
    blockedBy,
    blocking,
    subtasks,
    projectTasks: (current.projects ?? []).flatMap((project) => {
      const task = resolve(project);
      return task ? [task] : [];
    }),
  };
}

function normalizeLinkTarget(value: string): string {
  return linkTarget(value).toLocaleLowerCase();
}

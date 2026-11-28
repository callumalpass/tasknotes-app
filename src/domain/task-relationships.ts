import { linkTarget, recordMatchesLink } from "./completion";

import type { TaskSummary, TaskDependency } from "./task";

export interface ResolvedTaskDependency {
  dependency: TaskDependency;
  task?: TaskSummary;
}

export interface TaskRelationships {
  blockedBy: ResolvedTaskDependency[];
  blocking: TaskSummary[];
  subtasks: TaskSummary[];
  projectTasks: TaskSummary[];
}

/**
 * Builds relationship indexes in one pass. `blockedBy` and `projects` are the
 * only persisted edges; blocking tasks and subtasks are their inverses.
 */
export function taskRelationships(
  current: TaskSummary,
  tasks: readonly TaskSummary[],
): TaskRelationships {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const taskByPath = new Map<string, TaskSummary>();
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
  const blocking: TaskSummary[] = [];
  const subtasks: TaskSummary[] = [];

  // Reused project links and blocker references have one answer for this
  // drawer, regardless of how many tasks point at them.
  const matches = new Map<string, boolean>();
  function pointsToCurrent(link: string) {
    let match = matches.get(link);
    if (match === undefined) {
      match = recordMatchesLink(current.path, link);
      matches.set(link, match);
    }
    return match;
  }

  for (const candidate of tasks) {
    if (candidate.id === current.id) continue;
    if (
      (candidate.blockedBy ?? []).some(
        (dependency) =>
          dependency.uid === current.id || pointsToCurrent(dependency.uid),
      )
    )
      blocking.push(candidate);
    if ((candidate.projects ?? []).some(pointsToCurrent))
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

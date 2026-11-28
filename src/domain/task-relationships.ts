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
  // A drawer only needs forward lookups for its own project and blocker links.
  const links = new Set([
    ...(current.projects ?? []),
    ...(current.blockedBy ?? []).map(({ uid }) => uid),
  ]);
  const targets = new Set([...links].map(normalizeLinkTarget));
  const taskById = new Map<string, TaskSummary>();
  const taskByPath = new Map<string, TaskSummary>();
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
    if (links.has(candidate.id)) taskById.set(candidate.id, candidate);
    if (targets.size) {
      const path = normalizeLinkTarget(candidate.path);
      if (targets.has(path)) taskByPath.set(path, candidate);
      const name = path.slice(path.lastIndexOf("/") + 1);
      if (name && targets.has(name) && !taskByPath.has(name))
        taskByPath.set(name, candidate);
    }
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

  const resolve = (value: string) =>
    taskById.get(value) ?? taskByPath.get(normalizeLinkTarget(value));
  return {
    blockedBy: (current.blockedBy ?? []).map((dependency) => ({
      dependency,
      task: resolve(dependency.uid),
    })),
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

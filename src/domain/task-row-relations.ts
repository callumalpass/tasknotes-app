import { linkTarget } from "./completion";

import type { TaskSummary } from "./task";

/** What a list row says about a task's place among other tasks. */
export interface TaskRowRelation {
  /** Tasks that name this one as a project; archived ones are left out. */
  subtasks: number;
  subtasksDone: number;
  /** Dependencies that resolve to a task still waiting to be done. */
  blockedBy: number;
}

export type TaskRowRelations = Record<string, TaskRowRelation>;

/**
 * One pass over task metadata. Only tasks with something to show appear, so
 * the result stays small however large the collection is.
 */
export function taskRowRelations(
  tasks: Iterable<TaskSummary>,
): TaskRowRelations {
  const all = [...tasks];
  const byId = new Map<string, TaskSummary>();
  const byPath = new Map<string, TaskSummary>();
  const byName = new Map<string, TaskSummary>();
  for (const task of all) {
    byId.set(task.id, task);
    const path = normalize(task.path);
    byPath.set(path, task);
    const name = path.split("/").at(-1);
    if (name && !byName.has(name)) byName.set(name, task);
  }
  const resolve = (link: string): TaskSummary | undefined => {
    const target = normalize(link);
    if (!target) return undefined;
    return target.includes("/") ? byPath.get(target) : byName.get(target);
  };

  const relations: TaskRowRelations = {};
  const relation = (id: string) =>
    (relations[id] ??= { subtasks: 0, subtasksDone: 0, blockedBy: 0 });

  for (const task of all) {
    if (!task.archived) {
      const parents = new Set<string>();
      for (const project of task.projects ?? []) {
        const parent = resolve(project);
        if (parent && parent.id !== task.id) parents.add(parent.id);
      }
      for (const parent of parents) {
        const entry = relation(parent);
        entry.subtasks += 1;
        if (task.completed) entry.subtasksDone += 1;
      }
    }
    if (task.completed || task.archived) continue;
    const blockers = new Set<string>();
    for (const { uid } of task.blockedBy ?? []) {
      const blocker = byId.get(uid) ?? resolve(uid);
      if (
        blocker &&
        blocker.id !== task.id &&
        !blocker.completed &&
        !blocker.archived
      )
        blockers.add(blocker.id);
    }
    if (blockers.size) relation(task.id).blockedBy = blockers.size;
  }
  return relations;
}

function normalize(value: string): string {
  return linkTarget(value).toLocaleLowerCase();
}

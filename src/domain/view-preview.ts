import {
  compileFilter,
  createEvaluationContext,
  evaluateToPlain,
} from "obsidian-bases-expression";

import type { Task } from "./task";
import type { EditableViewDraft } from "./view-document";

export interface ViewDraftPreview {
  kind: "live" | "current" | "unavailable";
  count?: number;
  tasks: Task[];
}

export function previewViewDraft(
  draft: EditableViewDraft,
  tasks: readonly Task[],
): ViewDraftPreview {
  const matching = tasksForViewDraft(draft, tasks);
  if (!matching) return { kind: "unavailable", tasks: [] };
  return {
    kind: "live",
    count: matching.length,
    tasks: matching.slice(0, 3),
  };
}

/** Evaluate an editable Obsidian Bases view against an in-memory task set. */
export function tasksForViewDraft(
  draft: EditableViewDraft,
  tasks: readonly Task[],
): Task[] | null {
  if (draft.dialect !== "obsidian-bases") return null;

  const filter = compileFilter(
    draft.filter as Parameters<typeof compileFilter>[0],
  );
  if (!filter.valid) return null;
  const formulas = Object.fromEntries(
    draft.computedProperties.map(({ name, expression }) => [
      name.trim(),
      expression,
    ]),
  );
  const matching = tasks.filter((task) =>
    filter.evaluateToBoolean(evaluationContext(task, formulas)),
  );
  return sortTasks(matching, draft);
}

export function computedViewValues(
  draft: EditableViewDraft,
  task: Task,
): Record<string, unknown> {
  if (draft.dialect !== "obsidian-bases") return {};
  const formulas = Object.fromEntries(
    draft.computedProperties.map(({ name, expression }) => [
      name.trim(),
      expression,
    ]),
  );
  const context = evaluationContext(task, formulas);
  return Object.fromEntries(
    draft.computedProperties.map(({ name, expression }) => [
      `formula.${name.trim()}`,
      evaluateToPlain(expression, context),
    ]),
  );
}

function taskProperties(task: Task): Record<string, unknown> {
  return {
    ...task.frontmatter,
    ...task.customProperties,
    title: task.title,
    status: task.status,
    priority: task.priority,
    due: task.due,
    scheduled: task.scheduled,
    tags: task.tags,
    projects: task.projects,
    contexts: task.contexts,
    archived: task.archived,
    completed: task.completed,
    sortOrder: task.sortOrder,
  };
}

function sortTasks(tasks: Task[], draft: EditableViewDraft): Task[] {
  if (!draft.sort.length) return tasks;
  return [...tasks].sort((left, right) => {
    const leftValues = {
      ...taskProperties(left),
      ...computedViewValues(draft, left),
    };
    const rightValues = {
      ...taskProperties(right),
      ...computedViewValues(draft, right),
    };
    for (const rule of draft.sort) {
      const key = propertyKey(rule.property);
      const compared = compare(leftValues[key], rightValues[key]);
      if (compared) return rule.direction === "desc" ? -compared : compared;
    }
    return 0;
  });
}

function evaluationContext(task: Task, formulas: Record<string, string>) {
  return createEvaluationContext({
    note: taskProperties(task),
    file: {
      path: task.path,
      properties: task.frontmatter,
      tags: task.tags,
    },
    formulas,
  });
}

function propertyKey(reference: string): string {
  const bracket = reference.match(/^note\[["'](.+)["']\]$/);
  if (bracket) return bracket[1];
  return reference.startsWith("note.") ? reference.slice(5) : reference;
}

function compare(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === undefined || left === null || left === "") return 1;
  if (right === undefined || right === null || right === "") return -1;
  if (typeof left === "number" && typeof right === "number")
    return left - right;
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

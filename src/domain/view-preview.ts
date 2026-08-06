import {
  compileFilter,
  createEvaluationContext,
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
  if (draft.dialect !== "obsidian-bases")
    return { kind: "unavailable", tasks: [] };

  const filter = compileFilter(
    draft.filter as Parameters<typeof compileFilter>[0],
  );
  if (!filter.valid) return { kind: "unavailable", tasks: [] };
  const formulas = Object.fromEntries(
    draft.computedProperties.map(({ name, expression }) => [
      name.trim(),
      expression,
    ]),
  );
  const matching = tasks.filter((task) =>
    filter.evaluateToBoolean(
      createEvaluationContext({
        note: taskProperties(task),
        file: {
          path: task.path,
          properties: task.frontmatter,
          tags: task.tags,
        },
        formulas,
      }),
    ),
  );
  return {
    kind: "live",
    count: matching.length,
    tasks: sortTasks(matching, draft).slice(0, 3),
  };
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
    const leftValues = taskProperties(left);
    const rightValues = taskProperties(right);
    for (const rule of draft.sort) {
      const key = propertyKey(rule.property);
      const compared = compare(leftValues[key], rightValues[key]);
      if (compared) return rule.direction === "desc" ? -compared : compared;
    }
    return 0;
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

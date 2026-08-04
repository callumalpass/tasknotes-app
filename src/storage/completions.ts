import {
  completionMatches,
  recordCompletion,
  type CollectionRecord,
  type FieldCompletion,
  type FieldCompletionRequest,
} from "../domain/completion";

import type { Task } from "../domain/task";

export function completeTaskValues(
  tasks: Iterable<Task>,
  request: FieldCompletionRequest,
): FieldCompletion[] {
  const values = new Map<string, FieldCompletion>();
  for (const configured of request.configuredValues ?? []) {
    const value = configured.value.trim();
    if (!value) continue;
    values.set(value.toLocaleLowerCase(), {
      kind: "value",
      value,
      label: configured.label?.trim() || value,
    });
  }
  for (const task of tasks) {
    const raw = task.frontmatter[request.field];
    const entries = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    for (const entry of entries) {
      if (typeof entry !== "string" && typeof entry !== "number") continue;
      const value = String(entry).trim();
      if (!value) continue;
      values.set(value.toLocaleLowerCase(), {
        kind: "value",
        value,
        label: value,
      });
    }
  }
  return [...values.values()]
    .filter((completion) => completionMatches(completion, request.query ?? ""))
    .sort(compareCompletions)
    .slice(0, completionLimit(request));
}

export function completeRecords(
  records: Iterable<CollectionRecord>,
  request: FieldCompletionRequest,
  writeFormat: "wikilink" | "markdown",
): FieldCompletion[] {
  const query = request.query?.trim().toLocaleLowerCase() ?? "";
  const targetTypes = new Set(
    (request.targetTypes ?? []).map((value) => value.toLocaleLowerCase()),
  );
  const values = new Map<string, FieldCompletion>();
  for (const record of records) {
    if (
      targetTypes.size &&
      record.types.length &&
      !record.types.some((type) => targetTypes.has(type.toLocaleLowerCase()))
    )
      continue;
    if (
      query &&
      !record.label.toLocaleLowerCase().includes(query) &&
      !record.path.toLocaleLowerCase().includes(query)
    )
      continue;
    const completion = recordCompletion(record, writeFormat);
    values.set(record.path.toLocaleLowerCase(), completion);
  }
  return [...values.values()]
    .sort(compareCompletions)
    .slice(0, completionLimit(request));
}

export function completionLimit(request: FieldCompletionRequest): number {
  const limit = request.limit ?? 12;
  return Math.max(1, Math.min(50, Math.trunc(limit)));
}

function compareCompletions(
  left: FieldCompletion,
  right: FieldCompletion,
): number {
  return (
    left.label.localeCompare(right.label) ||
    (left.detail ?? "").localeCompare(right.detail ?? "")
  );
}

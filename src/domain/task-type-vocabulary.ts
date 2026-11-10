import { resolveTaskNotesModelConfigFromMdbaseType } from "@tasknotes/model/mdbase";

import { taskNotesImplementationOf } from "./tasknotes-contract";

import type { UserMappedFieldType } from "@tasknotes/model/types";
import type { TaskSummary } from "./task";

export interface TaskStatusEdit {
  value: string;
  label: string;
  color: string;
  isCompleted: boolean;
}

export interface TaskPriorityEdit {
  value: string;
  label: string;
  color: string;
}

export interface TaskCustomFieldEdit {
  key: string;
  displayName: string;
  type: UserMappedFieldType;
}

/**
 * A change to the words a collection's tasks may use. Statuses and priorities
 * are complete lists in display order; a priority's weight is its position.
 * Custom fields are named changes, so a property the app cannot edit is never
 * rewritten.
 */
export interface TaskVocabularyPatch {
  statuses?: TaskStatusEdit[];
  priorities?: TaskPriorityEdit[];
  customFields?: {
    add?: TaskCustomFieldEdit[];
    rename?: Array<Pick<TaskCustomFieldEdit, "key" | "displayName">>;
    remove?: string[];
  };
}

export type TaskVocabularyProblem =
  | { kind: "empty-label"; list: "status" | "priority" }
  | { kind: "duplicate-value"; list: "status" | "priority"; value: string }
  | { kind: "no-open-status" }
  | { kind: "no-completed-status" }
  | { kind: "no-priority" }
  | { kind: "default-removed"; list: "status" | "priority"; value: string }
  | { kind: "field-name"; key: string }
  | { kind: "field-taken"; key: string }
  | { kind: "field-label"; key: string };

/** A vocabulary change the collection cannot accept as it stands. */
export class TaskVocabularyError extends Error {
  constructor(readonly problem: TaskVocabularyProblem) {
    super(`The task settings are not valid: ${problem.kind}.`);
    this.name = "TaskVocabularyError";
  }
}

/** Tasks still hold a status or priority the change would remove. */
export class TaskVocabularyInUseError extends Error {
  constructor(
    readonly list: "status" | "priority",
    readonly value: string,
    readonly count: number,
  ) {
    super(
      `${count} task${count === 1 ? "" : "s"} still use the ${list} "${value}".`,
    );
    this.name = "TaskVocabularyInUseError";
  }
}

const FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const FALLBACK_COLOR = "#808080";

/** A stored value for a new status or priority, made from its label. */
export function vocabularyValue(label: string, taken: Iterable<string>) {
  const used = new Set(taken);
  const base =
    label
      .trim()
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "option";
  let value = base;
  for (let suffix = 2; used.has(value); suffix += 1)
    value = `${base}-${suffix}`;
  return value;
}

/** A property name for a new custom field, made from its label. */
export function customFieldKey(label: string, taken: Iterable<string>) {
  const used = new Set([...taken].map((key) => key.toLocaleLowerCase()));
  const base =
    label
      .trim()
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^([0-9])/, "_$1") || "field";
  let key = base;
  for (let suffix = 2; used.has(key); suffix += 1) key = `${base}_${suffix}`;
  return key;
}

/** The first rule a status and priority list breaks, if any. */
export function vocabularyProblem(
  patch: Pick<TaskVocabularyPatch, "statuses" | "priorities">,
  defaults: { status: string; priority: string },
): TaskVocabularyProblem | null {
  if (patch.statuses) {
    const problem = listProblem("status", patch.statuses);
    if (problem) return problem;
    if (!patch.statuses.some((status) => !status.isCompleted))
      return { kind: "no-open-status" };
    if (!patch.statuses.some((status) => status.isCompleted))
      return { kind: "no-completed-status" };
    if (!patch.statuses.some(({ value }) => value === defaults.status))
      return {
        kind: "default-removed",
        list: "status",
        value: defaults.status,
      };
  }
  if (patch.priorities) {
    const problem = listProblem("priority", patch.priorities);
    if (problem) return problem;
    if (!patch.priorities.length) return { kind: "no-priority" };
    if (!patch.priorities.some(({ value }) => value === defaults.priority))
      return {
        kind: "default-removed",
        list: "priority",
        value: defaults.priority,
      };
  }
  return null;
}

function listProblem(
  list: "status" | "priority",
  entries: ReadonlyArray<{ value: string; label: string }>,
): TaskVocabularyProblem | null {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.label.trim() || !entry.value.trim())
      return { kind: "empty-label", list };
    if (seen.has(entry.value))
      return { kind: "duplicate-value", list, value: entry.value };
    seen.add(entry.value);
  }
  return null;
}

/**
 * The first status or priority a change removes while tasks still hold it.
 * Removing it would leave those tasks outside the type's own schema.
 */
export function vocabularyInUse(
  tasks: Iterable<Pick<TaskSummary, "status" | "priority">>,
  current: { statuses: string[]; priorities: string[] },
  patch: Pick<TaskVocabularyPatch, "statuses" | "priorities">,
): TaskVocabularyInUseError | null {
  const removed = (before: string[], after?: Array<{ value: string }>) => {
    if (!after) return new Map<string, number>();
    const kept = new Set(after.map(({ value }) => value));
    return new Map(
      before.filter((value) => !kept.has(value)).map((value) => [value, 0]),
    );
  };
  const statuses = removed(current.statuses, patch.statuses);
  const priorities = removed(current.priorities, patch.priorities);
  if (!statuses.size && !priorities.size) return null;
  for (const task of tasks) {
    const status = statuses.get(task.status);
    if (status !== undefined) statuses.set(task.status, status + 1);
    const priority = priorities.get(task.priority);
    if (priority !== undefined) priorities.set(task.priority, priority + 1);
  }
  for (const [value, count] of statuses)
    if (count) return new TaskVocabularyInUseError("status", value, count);
  for (const [value, count] of priorities)
    if (count) return new TaskVocabularyInUseError("priority", value, count);
  return null;
}

/**
 * Rewrite the parts of a TaskNotes task type that name its statuses,
 * priorities and custom fields. Everything else in the type, including
 * properties and binding entries this app does not know, is preserved.
 *
 * `defaults` names the default status and priority being saved in the same
 * step, so a default can move to a new value as its old one is removed.
 */
export function patchTaskTypeVocabulary(
  type: Record<string, unknown>,
  patch: TaskVocabularyPatch,
  defaults: { status?: string; priority?: string } = {},
): Record<string, unknown> {
  const result = structuredClone(type);
  const implementation = taskNotesImplementationOf(result);
  if (!implementation)
    throw new Error("The mdbase type is not a TaskNotes task contract.");
  const model = resolveTaskNotesModelConfigFromMdbaseType(result);
  const binding = section(implementation, "binding");
  const schema = section(section(result, "schema"), "value");
  const properties = section(schema, "properties");
  const readDefaults = section(section(result, "collection"), "read_defaults");

  const problem = vocabularyProblem(patch, {
    status: defaults.status ?? model.defaults.status,
    priority: defaults.priority ?? model.defaults.priority,
  });
  if (problem) throw new TaskVocabularyError(problem);

  if (patch.statuses) {
    const field = model.fieldMapping.status;
    const status = section(binding, "status");
    const existing = definitionsByValue(status.definitions);
    const values = patch.statuses.map(({ value }) => value);
    const kept = new Set(values);
    const completed = patch.statuses
      .filter((entry) => entry.isCompleted)
      .map(({ value }) => value);
    const skipped = strings(status.skipped_values).filter(
      (value) => kept.has(value) && !completed.includes(value),
    );
    const fallback = defaults.status ?? model.defaults.status;
    status.values = values;
    status.default = fallback;
    status.completed_values = completed;
    status.skipped_values = skipped;
    if (
      typeof status.default_skipped === "string" &&
      !skipped.includes(status.default_skipped)
    ) {
      if (skipped[0]) status.default_skipped = skipped[0];
      else delete status.default_skipped;
    }
    status.definitions = patch.statuses.map((entry, order) => {
      const previous = { ...(existing.get(entry.value) ?? {}) };
      delete previous.isCompleted;
      delete previous.isSkipped;
      return {
        ...previous,
        value: entry.value,
        label: entry.label.trim(),
        color: entry.color.trim() || FALLBACK_COLOR,
        is_completed: entry.isCompleted,
        is_skipped: skipped.includes(entry.value),
        order,
      };
    });
    setEnum(properties[field], values, fallback);
    readDefaults[field] = fallback;
    // The type requires a completion date for exactly the completed statuses.
    for (const rule of records(schema.allOf)) {
      const condition = record(record(record(rule.if).properties)[field]);
      if (Array.isArray(condition.enum)) condition.enum = [...completed];
    }
  }

  if (patch.priorities) {
    const field = model.fieldMapping.priority;
    const priority = section(binding, "priority");
    const existing = definitionsByValue(priority.definitions);
    const values = patch.priorities.map(({ value }) => value);
    const fallback = defaults.priority ?? model.defaults.priority;
    priority.values = values;
    priority.default = fallback;
    priority.definitions = patch.priorities.map((entry, weight) => ({
      ...(existing.get(entry.value) ?? {}),
      value: entry.value,
      label: entry.label.trim(),
      color: entry.color.trim() || FALLBACK_COLOR,
      weight,
    }));
    setEnum(properties[field], values, fallback);
    readDefaults[field] = fallback;
  }

  const fields = patch.customFields;
  if (fields) {
    const reserved = new Set(
      [
        ...Object.keys(model.fieldMapping),
        ...Object.values(model.fieldMapping),
        "id",
        "tags",
        "type",
        "types",
      ].map((key) => key.toLocaleLowerCase()),
    );
    for (const key of fields.remove ?? []) {
      if (reserved.has(key.toLocaleLowerCase())) continue;
      delete properties[key];
      delete readDefaults[key];
      if (Array.isArray(schema.required))
        schema.required = schema.required.filter((name) => name !== key);
    }
    for (const { key, displayName } of fields.rename ?? []) {
      const property = properties[key];
      if (!isRecord(property)) continue;
      if (!displayName.trim())
        throw new TaskVocabularyError({ kind: "field-label", key });
      property.title = displayName.trim();
    }
    const nullable = Object.values(properties).some(
      (property) =>
        isRecord(property) &&
        Array.isArray(property.anyOf) &&
        property.anyOf.some((branch) => record(branch).type === "null"),
    );
    for (const field of fields.add ?? []) {
      const key = field.key.trim();
      if (!FIELD_KEY.test(key))
        throw new TaskVocabularyError({ kind: "field-name", key });
      if (
        reserved.has(key.toLocaleLowerCase()) ||
        Object.keys(properties).some(
          (name) => name.toLocaleLowerCase() === key.toLocaleLowerCase(),
        )
      )
        throw new TaskVocabularyError({ kind: "field-taken", key });
      if (!field.displayName.trim())
        throw new TaskVocabularyError({ kind: "field-label", key });
      const value = customFieldSchema(field.type);
      properties[key] = {
        title: field.displayName.trim(),
        ...(nullable ? { anyOf: [value, { type: "null" }] } : value),
      };
    }
  }

  return result;
}

function customFieldSchema(type: UserMappedFieldType): Record<string, unknown> {
  if (type === "number") return { type: "number" };
  if (type === "date") return { type: "string", format: "date" };
  if (type === "boolean") return { type: "boolean" };
  if (type === "list") return { type: "array", items: { type: "string" } };
  return { type: "string" };
}

/** Narrow or widen an enum property, wherever a nullable wrapper keeps it. */
function setEnum(property: unknown, values: string[], fallback: string) {
  if (!isRecord(property)) return;
  const holder = Array.isArray(property.enum)
    ? property
    : Array.isArray(property.anyOf)
      ? property.anyOf.find(
          (branch): branch is Record<string, unknown> =>
            isRecord(branch) && Array.isArray(branch.enum),
        )
      : undefined;
  if (!holder) return;
  holder.enum = [...values];
  if ("default" in holder) holder.default = fallback;
}

function definitionsByValue(
  value: unknown,
): Map<string, Record<string, unknown>> {
  return new Map(
    records(value).flatMap((definition) =>
      typeof definition.value === "string"
        ? [[definition.value, definition] as const]
        : [],
    ),
  );
}

function section(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const current = parent[key];
  if (isRecord(current)) return current;
  const created: Record<string, unknown> = {};
  parent[key] = created;
  return created;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

import type { FieldMapping } from "@tasknotes/model/types";

import type { TaskCollectionConfiguration } from "./task-configuration";
import type { Task, UpdateTaskInput } from "./task";

export type ViewFieldMapping = Partial<FieldMapping>;

const readOnlyProperties = new Set([
  "id",
  "path",
  "created_at",
  "updated_at",
  "completed_date",
  "recurrence_parent",
  "occurrence_date",
  "complete_instances",
  "skipped_instances",
  "time_entries",
]);

const editableMappedRoles: Record<string, string> = {
  title: "title",
  status: "status",
  priority: "priority",
  due: "due",
  scheduled: "scheduled",
  contexts: "contexts",
  projects: "projects",
  timeEstimate: "time_estimate",
};

export function viewPropertyName(
  property: string,
  fieldMapping?: ViewFieldMapping,
): string | null {
  const normalized = property.startsWith("note.")
    ? property.slice("note.".length)
    : property;
  if (
    !normalized ||
    normalized.startsWith("file.") ||
    normalized.startsWith("formula.") ||
    normalized.includes("[") ||
    readOnlyProperties.has(normalized)
  )
    return null;
  if (fieldMapping) {
    const mappedRole = Object.entries(fieldMapping).find(
      ([, field]) => field === normalized,
    )?.[0];
    if (mappedRole && !Object.hasOwn(editableMappedRoles, mappedRole))
      return null;
  }
  return normalized;
}

export function viewPropertyRole(
  property: string,
  fieldMapping?: ViewFieldMapping,
): string | null {
  const field = viewPropertyName(property, fieldMapping);
  if (!field) return null;
  if (fieldMapping) {
    const mappedRole = Object.entries(fieldMapping).find(
      ([, mappedField]) => mappedField === field,
    )?.[0];
    if (mappedRole) return editableMappedRoles[mappedRole] ?? null;
    return ["tags", "completed", "archived"].includes(field) ? field : "custom";
  }
  return [
    "title",
    "status",
    "priority",
    "due",
    "scheduled",
    "tags",
    "projects",
    "contexts",
    "archived",
    "completed",
    "time_estimate",
  ].includes(field)
    ? field
    : "custom";
}

export function viewPropertyMoveInput({
  task,
  property,
  destinationValue,
  sourceValue,
  preserveOtherListValues = false,
  configuration,
}: {
  task: Task;
  property: string;
  destinationValue: unknown;
  sourceValue?: unknown;
  preserveOtherListValues?: boolean;
  configuration?:
    TaskCollectionConfiguration | { fieldMapping?: ViewFieldMapping };
}): UpdateTaskInput | null {
  const fieldMapping = configuration?.fieldMapping;
  const field = viewPropertyName(property, fieldMapping);
  if (!field) return null;
  const role = viewPropertyRole(property, fieldMapping);
  if (!role) return null;

  if (role === "title")
    return typeof destinationValue === "string" && destinationValue.trim()
      ? { title: destinationValue.trim() }
      : null;
  if (role === "status")
    return typeof destinationValue === "string"
      ? { status: destinationValue }
      : null;
  if (role === "priority")
    return typeof destinationValue === "string"
      ? { priority: destinationValue }
      : null;
  if (role === "due" || role === "scheduled")
    return {
      [role]:
        typeof destinationValue === "string" && destinationValue
          ? destinationValue
          : null,
    };
  if (role === "tags" || role === "projects" || role === "contexts") {
    const values = preserveOtherListValues
      ? moveListValue(task[role], sourceValue, destinationValue)
      : listValue(destinationValue);
    return { [role]: values };
  }
  if (role === "archived" || role === "completed")
    return typeof destinationValue === "boolean"
      ? { [role]: destinationValue }
      : null;
  if (role === "time_estimate")
    return {
      timeEstimate:
        typeof destinationValue === "number" ? destinationValue : null,
    };

  const customProperties = { ...task.customProperties };
  const customIsList =
    hasUserFields(configuration) &&
    configuration.userFields.some(
      (candidate) => candidate.key === field && candidate.type === "list",
    );
  if (customIsList && preserveOtherListValues) {
    customProperties[field] = moveListValue(
      customProperties[field],
      sourceValue,
      destinationValue,
    );
  } else if (
    destinationValue === null ||
    destinationValue === undefined ||
    destinationValue === ""
  ) {
    delete customProperties[field];
  } else {
    customProperties[field] = structuredClone(destinationValue);
  }
  return { customProperties };
}

export function viewGroupMoveInput(
  task: Task,
  sourceValues: Record<string, unknown>,
  destinationValues: Record<string, unknown>,
  configuration: TaskCollectionConfiguration,
): UpdateTaskInput | null {
  const properties = new Set([
    ...Object.keys(sourceValues),
    ...Object.keys(destinationValues),
  ]);
  if (!properties.size) return {};

  let result: UpdateTaskInput = {};
  let currentTask = task;
  for (const property of properties) {
    const input = viewPropertyMoveInput({
      task: currentTask,
      property,
      sourceValue: sourceValues[property] ?? null,
      destinationValue: destinationValues[property] ?? null,
      preserveOtherListValues: true,
      configuration,
    });
    if (!input) return null;
    result = mergeMoveInputs(result, input);
    if (input.customProperties)
      currentTask = {
        ...currentTask,
        customProperties: input.customProperties,
      };
  }
  return result;
}

function mergeMoveInputs(
  current: UpdateTaskInput,
  next: UpdateTaskInput,
): UpdateTaskInput {
  return {
    ...current,
    ...next,
    ...(current.customProperties || next.customProperties
      ? {
          customProperties: {
            ...(current.customProperties ?? {}),
            ...(next.customProperties ?? {}),
          },
        }
      : {}),
  };
}

function moveListValue(
  current: unknown,
  source: unknown,
  destination: unknown,
): string[] {
  const removed = new Set(listValue(source));
  return uniqueStrings([
    ...listValue(current).filter((value) => !removed.has(value)),
    ...listValue(destination),
  ]);
}

function listValue(value: unknown): string[] {
  if (value === null || value === undefined || value === "") return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function hasUserFields(
  configuration:
    | TaskCollectionConfiguration
    | { fieldMapping?: ViewFieldMapping }
    | undefined,
): configuration is TaskCollectionConfiguration {
  return Boolean(configuration && "userFields" in configuration);
}

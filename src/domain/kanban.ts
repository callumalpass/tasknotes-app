import type { FieldMapping } from "@tasknotes/model/types";

import type { Task, UpdateTaskInput } from "./task";

export type KanbanFieldMapping = Partial<FieldMapping>;

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

export function kanbanPropertyName(
  property: string,
  fieldMapping?: KanbanFieldMapping,
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

export function kanbanPropertyRole(
  property: string,
  fieldMapping?: KanbanFieldMapping,
): string | null {
  const field = kanbanPropertyName(property, fieldMapping);
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

export function kanbanMoveInput(
  task: Task,
  property: string,
  value: unknown,
  fieldMapping?: KanbanFieldMapping,
): UpdateTaskInput | null {
  const field = kanbanPropertyName(property, fieldMapping);
  if (!field) return null;
  const role = kanbanPropertyRole(property, fieldMapping);
  if (!role) return null;

  if (role === "title")
    return typeof value === "string" && value.trim()
      ? { title: value.trim() }
      : null;
  if (role === "status")
    return typeof value === "string" ? { status: value } : null;
  if (role === "priority")
    return typeof value === "string" ? { priority: value } : null;
  if (role === "due" || role === "scheduled")
    return {
      [role]: typeof value === "string" && value ? value : null,
    };
  if (role === "tags" || role === "projects" || role === "contexts")
    return {
      [role]: listValue(value),
    };
  if (role === "archived" || role === "completed")
    return typeof value === "boolean" ? { [role]: value } : null;
  if (role === "time_estimate")
    return {
      timeEstimate: typeof value === "number" ? value : null,
    };

  const customProperties = { ...task.customProperties };
  if (value === null || value === undefined || value === "")
    delete customProperties[field];
  else customProperties[field] = structuredClone(value);
  return { customProperties };
}

function listValue(value: unknown): string[] {
  if (value === null || value === undefined || value === "") return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

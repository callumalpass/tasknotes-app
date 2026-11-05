import type { TaskSummary, UpdateTaskInput } from "../domain/task";
import type { EditableProperty } from "./task-property-kind";

export function propertyValue(
  task: TaskSummary,
  property: EditableProperty | null,
): unknown {
  if (!property) return undefined;
  return property.kind === "custom"
    ? task.customProperties[property.key]
    : task[property.kind];
}

export function updateFor(
  task: TaskSummary,
  property: EditableProperty,
  value: unknown,
  anchor?: "scheduled" | "completion",
): UpdateTaskInput {
  if (property.kind === "custom") {
    const customProperties = { ...task.customProperties };
    if (
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && !value.length)
    )
      delete customProperties[property.key];
    else customProperties[property.key] = value;
    return { customProperties };
  }
  if (["projects", "tags", "contexts"].includes(property.kind))
    return { [property.kind]: Array.isArray(value) ? value : [] };
  if (
    property.kind === "scheduled" ||
    property.kind === "due" ||
    property.kind === "recurrence"
  )
    return {
      [property.kind]: typeof value === "string" && value ? value : null,
      ...(property.kind === "recurrence" && anchor
        ? { recurrenceAnchor: anchor }
        : {}),
    };
  return { [property.kind]: String(value) };
}

import type { TaskSummary, UpdateTaskInput } from "./task";
import {
  viewPropertyMoveInput,
  viewPropertyName,
  viewPropertyRole,
  type ViewFieldMapping,
} from "./view-mutation";

export type KanbanFieldMapping = ViewFieldMapping;

export function kanbanPropertyName(
  property: string,
  fieldMapping?: KanbanFieldMapping,
): string | null {
  return viewPropertyName(property, fieldMapping);
}

export function kanbanPropertyRole(
  property: string,
  fieldMapping?: KanbanFieldMapping,
): string | null {
  return viewPropertyRole(property, fieldMapping);
}

export function kanbanMoveInput(
  task: TaskSummary,
  property: string,
  value: unknown,
  fieldMapping?: KanbanFieldMapping,
): UpdateTaskInput | null {
  return viewPropertyMoveInput({
    task,
    property,
    destinationValue: value,
    configuration: { fieldMapping },
  });
}

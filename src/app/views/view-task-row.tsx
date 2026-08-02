import { TaskRow } from "../../components/task-row";
import { viewPropertyDetails } from "../../domain/view-values";

import type { Task } from "../../domain/task";
import type { TaskOccurrence } from "../../domain/task-occurrence";
import type { TaskViewProperty, TaskViewRow } from "../../domain/view";

export function ViewTaskRow({
  row,
  properties,
  titleProperty,
  omittedProperties = [],
  occurrence,
  onOpen,
  onToggle,
}: {
  row: TaskViewRow;
  properties: TaskViewProperty[];
  titleProperty?: string;
  omittedProperties?: string[];
  occurrence?: TaskOccurrence;
  onOpen(task: Task): void;
  onToggle(task: Task): void;
}) {
  const details = viewPropertyDetails(row, properties, {
    identityProperty: titleProperty,
    omittedProperties,
    occurrence,
    suppressRoutineDefaults: true,
  });
  return (
    <TaskRow
      task={row.task}
      details={details}
      occurrence={occurrence}
      onOpen={onOpen}
      onToggle={onToggle}
    />
  );
}

import { memo } from "react";

import { TaskRow } from "../../components/task-row";
import { viewPropertyDetails } from "../../i18n/view-presentation";

import type { TaskSummary } from "../../domain/task";
import type { TaskOccurrence } from "../../domain/task-occurrence";
import type { TaskViewProperty, TaskViewRow } from "../../domain/view";

/** Memoized: a re-query reuses unchanged row objects, so only edited rows
 * re-render. */
export const ViewTaskRow = memo(function ViewTaskRow({
  row,
  properties,
  titleProperty,
  omittedProperties = [],
  occurrence,
  sectionDay,
  onOpen,
  onToggle,
}: {
  row: TaskViewRow;
  properties: TaskViewProperty[];
  titleProperty?: string;
  omittedProperties?: string[];
  occurrence?: TaskOccurrence;
  /** The day this row's section already names. */
  sectionDay?: string;
  onOpen(task: TaskSummary): void;
  onToggle(task: TaskSummary): void;
}) {
  const details = viewPropertyDetails(row, properties, {
    identityProperty: titleProperty,
    omittedProperties,
    occurrence,
  });
  return (
    <TaskRow
      task={row.task}
      details={details}
      ensurePriority={omittedProperties.length === 0}
      occurrence={occurrence}
      sectionDay={sectionDay}
      onOpen={onOpen}
      onToggle={onToggle}
    />
  );
});

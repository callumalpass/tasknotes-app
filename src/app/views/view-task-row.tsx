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
  ensurePriority = omittedProperties.length === 0,
  occurrence,
  sectionDay,
  contextProperties,
  onOpen,
  onToggle,
}: {
  row: TaskViewRow;
  properties: TaskViewProperty[];
  titleProperty?: string;
  omittedProperties?: string[];
  ensurePriority?: boolean;
  occurrence?: TaskOccurrence;
  /** The day this row's section already names. */
  sectionDay?: string;
  contextProperties?: Record<string, unknown>;
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
      ensurePriority={ensurePriority}
      occurrence={occurrence}
      sectionDay={sectionDay}
      contextProperties={contextProperties}
      omittedProperties={omittedProperties}
      onOpen={onOpen}
      onToggle={onToggle}
    />
  );
});

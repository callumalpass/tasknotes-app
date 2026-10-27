import {
  planCalendarEdit,
  planCalendarOccurrenceChoice,
  type CalendarChange,
  type CalendarEntry,
  type CalendarOccurrenceChoice,
} from "@tasknotes/model/calendar";
import type { TaskSummary } from "./task";
import type { TaskCollectionConfiguration } from "./task-configuration";
import { storedCalendarTime, TaskNotesTaskModel } from "./tasknotes-model";

/** A gesture, not a stale task snapshot. Repositories plan against a fresh read. */
export interface CalendarTaskEdit {
  entry: CalendarEntry;
  change: CalendarChange;
  timezone: string;
  now?: string;
}

/** Fields an occurrence note takes from a calendar gesture instead of its parent. */
export type OccurrenceOverrides =
  CalendarOccurrenceChoice["occurrence"]["overrides"];

/** The this-occurrence/series choice for a gesture on a generated recurring occurrence. */
export function calendarOccurrenceChoice(
  task: TaskSummary,
  edit: CalendarTaskEdit,
  configuration: TaskCollectionConfiguration,
): CalendarOccurrenceChoice | undefined {
  const choice = planCalendarOccurrenceChoice({
    task: new TaskNotesTaskModel(configuration).calendarTaskInfo(task),
    entry: edit.entry,
    change: edit.change,
    timezone: edit.timezone,
  });
  if (!choice) return undefined;
  // The plan states times on the calendar's wall clock; tasks store instants.
  const { scheduled, due } = choice.occurrence.overrides;
  return {
    ...choice,
    occurrence: {
      ...choice.occurrence,
      overrides: {
        ...choice.occurrence.overrides,
        ...(scheduled === undefined
          ? {}
          : { scheduled: storedCalendarTime(scheduled, edit.timezone) }),
        ...(due === undefined
          ? {}
          : { due: storedCalendarTime(due, edit.timezone) }),
      },
    },
  };
}

/** Completed and skipped dates a calendar gesture on the series would clear,
 * so the caller can ask before losing them. */
export function calendarClearedInstances(
  task: TaskSummary,
  edit: CalendarTaskEdit,
  configuration: TaskCollectionConfiguration,
): string[] {
  const model = new TaskNotesTaskModel(configuration);
  const { clearedInstances } = planCalendarEdit({
    task: model.calendarTaskInfo(task),
    ...edit,
    now: edit.now ?? new Date().toISOString(),
    fieldMapping: model.config.fieldMapping,
  });
  return [...clearedInstances.complete, ...clearedInstances.skipped].sort();
}

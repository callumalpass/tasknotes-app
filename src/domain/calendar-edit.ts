import {
  planCalendarOccurrenceChoice,
  type CalendarChange,
  type CalendarEntry,
  type CalendarOccurrenceChoice,
} from "@tasknotes/model/calendar";
import type { TaskSummary } from "./task";
import type { TaskCollectionConfiguration } from "./task-configuration";
import { TaskNotesTaskModel } from "./tasknotes-model";

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
  return planCalendarOccurrenceChoice({
    task: new TaskNotesTaskModel(configuration).calendarTaskInfo(task),
    entry: edit.entry,
    change: edit.change,
    timezone: edit.timezone,
  });
}

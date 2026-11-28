import { useEffect, useMemo } from "react";
import {
  AppCalendarEntryIndex,
  type CalendarEntry,
  calendarContext,
  calendarSettings,
} from "../domain/calendar-events";
import type { CalendarSettings } from "@tasknotes/model/calendar";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskSummary } from "../domain/task";
import type { TaskViewExecution } from "../domain/view";

const noMaterializations: readonly TaskSummary[] = [];

export function useCalendarEntries(
  execution: TaskViewExecution,
  range: { start: Date; end: Date } | null,
  identityTasks: readonly TaskSummary[],
  configuration: TaskCollectionConfiguration,
  display: CalendarSettings,
) {
  const index = useMemo(
    () => new AppCalendarEntryIndex(configuration),
    [configuration],
  );
  useEffect(() => () => index.clear(), [index]);
  // Loading the identity query commonly replaces an empty array with a
  // collection containing no occurrence children. Its expansion is identical.
  const occurrenceIdentities = useMemo(
    () =>
      identityTasks.some((task) => task.recurrenceParent && task.occurrenceDate)
        ? identityTasks
        : noMaterializations,
    [identityTasks],
  );
  return useMemo(() => {
    if (!range) return new Map<string, CalendarEntry[]>();
    const context = calendarContext(configuration);
    return index.entries(
      execution,
      {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      occurrenceIdentities,
      {
        ...context,
        settings: calendarSettings(execution, configuration, display),
      },
      { showMissedRepeats: true },
    );
  }, [index, execution, range, occurrenceIdentities, configuration, display]);
}

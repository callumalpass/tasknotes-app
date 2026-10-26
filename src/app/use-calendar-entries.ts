import { useEffect, useMemo } from "react";
import {
  AppCalendarEntryIndex,
  calendarContext,
  calendarSettings,
} from "../domain/calendar-events";
import type { CalendarSettings } from "@tasknotes/model/calendar";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskSummary } from "../domain/task";
import type { TaskViewExecution } from "../domain/view";

export function useCalendarEntries(
  execution: TaskViewExecution,
  range: { start: Date; end: Date },
  identityTasks: readonly TaskSummary[],
  configuration: TaskCollectionConfiguration,
  display: CalendarSettings,
) {
  const index = useMemo(
    () => new AppCalendarEntryIndex(configuration),
    [configuration],
  );
  useEffect(() => () => index.clear(), [index]);
  return useMemo(() => {
    const context = calendarContext();
    return index.entries(
      execution,
      {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      identityTasks,
      {
        ...context,
        settings: calendarSettings(execution, configuration, display),
      },
    );
  }, [index, execution, range, identityTasks, configuration, display]);
}

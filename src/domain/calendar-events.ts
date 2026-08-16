import { taskDatePart, todayString } from "./task";
import {
  materializedOccurrenceKeys,
  occurrenceTask,
  taskOccurrencesBetween,
} from "./task-occurrence";

import type { Task, TaskTimeEntry } from "./task";
import type { TaskOccurrence } from "./task-occurrence";
import type { TaskViewExecution, TaskViewRow } from "./view";

export interface CalendarEntry {
  task: Task;
  row: TaskViewRow;
  occurrence?: TaskOccurrence;
  timeEntry?: TaskTimeEntry;
  timeEntryIndex?: number;
}

export function calendarEvents(
  execution: TaskViewExecution,
  rangeStart: Date,
  rangeEnd: Date,
  identityTasks: readonly Task[],
  display: { showTimeEntries?: boolean } = {},
): Map<string, CalendarEntry[]> {
  const events = new Map<string, CalendarEntry[]>();
  const options = execution.view.presentation?.options ?? {};
  const showScheduled = options.showScheduled !== false;
  const showDue = options.showDue !== false;
  const showRecurring = options.showRecurring !== false;
  const showCompletedRecurring =
    options.showCompletedRecurringInstances === true;
  const showSkippedRecurring = options.showSkippedRecurringInstances === true;
  const materialized = materializedOccurrenceKeys(identityTasks);
  for (const row of execution.rows) {
    const { task } = row;
    if (display.showTimeEntries)
      task.timeEntries.forEach((timeEntry, timeEntryIndex) => {
        const start = new Date(timeEntry.startTime);
        if (
          Number.isNaN(start.getTime()) ||
          start > rangeEnd ||
          (timeEntry.endTime && new Date(timeEntry.endTime) < rangeStart)
        )
          return;
        append(events, todayString(start), {
          task,
          row,
          timeEntry,
          timeEntryIndex,
        });
      });
    if (task.recurrence) {
      if (!showRecurring && !showCompletedRecurring && !showSkippedRecurring)
        continue;
      for (const occurrence of taskOccurrencesBetween(
        task,
        todayString(rangeStart),
        todayString(rangeEnd),
      )) {
        if (materialized.has(occurrence.key)) continue;
        if (
          (occurrence.completed && !showCompletedRecurring) ||
          (occurrence.skipped && !showSkippedRecurring) ||
          (!occurrence.completed && !occurrence.skipped && !showRecurring)
        )
          continue;
        const projected = occurrenceTask(occurrence);
        const dates = new Set([
          ...(showScheduled && projected.scheduled
            ? [taskDatePart(projected.scheduled)]
            : []),
          ...(showDue && projected.due ? [taskDatePart(projected.due)] : []),
        ]);
        for (const date of dates)
          append(events, date, { task, row, occurrence });
      }
      continue;
    }
    for (const value of new Set([
      ...(showScheduled && task.scheduled ? [task.scheduled] : []),
      ...(showDue && task.due ? [task.due] : []),
    ]))
      append(events, taskDatePart(value), { task, row });
  }
  return events;
}

export function calendarEntryKey(entry: CalendarEntry): string {
  if (entry.timeEntryIndex !== undefined)
    return `${entry.task.id}:time:${entry.timeEntryIndex}`;
  return entry.occurrence?.key ?? entry.task.id;
}

function append(
  events: Map<string, CalendarEntry[]>,
  date: string,
  entry: CalendarEntry,
): void {
  if (!date) return;
  const tasks = events.get(date) ?? [];
  tasks.push(entry);
  events.set(date, tasks);
}

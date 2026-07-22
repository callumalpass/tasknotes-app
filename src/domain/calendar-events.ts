import { taskDatePart, todayString } from "./task";
import {
  materializedOccurrenceKeys,
  occurrenceTask,
  taskOccurrencesBetween,
} from "./task-occurrence";

import type { Task } from "./task";
import type { TaskOccurrence } from "./task-occurrence";
import type { TaskViewExecution } from "./view";

export interface CalendarEntry {
  task: Task;
  occurrence?: TaskOccurrence;
}

export function calendarEvents(
  execution: TaskViewExecution,
  rangeStart: Date,
  rangeEnd: Date,
  identityTasks: readonly Task[],
): Map<string, CalendarEntry[]> {
  const events = new Map<string, CalendarEntry[]>();
  const options = execution.view.presentation?.options ?? {};
  const showScheduled = options.showScheduled !== false;
  const showDue = options.showDue !== false;
  const materialized = materializedOccurrenceKeys(identityTasks);
  for (const { task } of execution.rows) {
    if (task.recurrence) {
      for (const occurrence of taskOccurrencesBetween(
        task,
        todayString(rangeStart),
        todayString(rangeEnd),
      )) {
        if (materialized.has(occurrence.key) || occurrence.skipped) continue;
        const projected = occurrenceTask(occurrence);
        const dates = new Set([
          ...(showScheduled && projected.scheduled
            ? [taskDatePart(projected.scheduled)]
            : []),
          ...(showDue && projected.due ? [taskDatePart(projected.due)] : []),
        ]);
        for (const date of dates) append(events, date, { task, occurrence });
      }
      continue;
    }
    for (const value of new Set([
      ...(showScheduled && task.scheduled ? [task.scheduled] : []),
      ...(showDue && task.due ? [task.due] : []),
    ]))
      append(events, taskDatePart(value), { task });
  }
  return events;
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

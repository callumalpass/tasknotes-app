import { shiftTaskDate } from "./task-date-actions";
import { taskDatePart, todayString, type TaskSummary } from "./task";
import {
  materializedOccurrenceKeys,
  projectUpcomingTasks,
  type TaskOccurrenceEntry,
} from "./task-occurrence";

/** How far ahead a repeating task is expanded when looking for what's next. */
const NEXT_HORIZON_DAYS = 60;

export interface TodaySummary {
  /** Tasks finished today that the day classifier would have placed on Today. */
  completedToday: number;
  /** The earliest open task or occurrence after today. */
  next?: TaskOccurrenceEntry;
}

/**
 * Summarize the collection around the Today screen from task metadata alone.
 * A task counts as done today when it was completed today and its Scheduled
 * date (or Due, without one) is today, mirroring the Today section. For a
 * repeating series, today's completed instance counts unless a separate
 * occurrence note already represents it.
 */
export function summarizeToday(
  tasks: readonly TaskSummary[],
  today = todayString(),
): TodaySummary {
  const active = tasks.filter((task) => !task.archived);
  const materialized = materializedOccurrenceKeys(active);
  let completedToday = 0;
  for (const task of active) {
    if (task.recurrence && !task.occurrenceDate) {
      if (
        task.completeInstances.includes(today) &&
        !materialized.has(`${task.id}:${today}`)
      )
        completedToday += 1;
      continue;
    }
    if (
      task.completed &&
      taskDatePart(task.completedDate) === today &&
      taskDatePart(task.scheduled ?? task.due) === today
    )
      completedToday += 1;
  }
  const next = projectUpcomingTasks(
    active,
    today,
    shiftTaskDate(today, NEXT_HORIZON_DAYS),
    1,
  ).groups[0]?.tasks[0];
  return { completedToday, ...(next ? { next } : {}) };
}

import type { Task } from "./task";
import { todayString } from "./task";

/** Completion belongs to an occurrence for virtual recurring rows, otherwise to the record. */
export function taskCompletion(task: Task, occurrenceDate?: string): boolean {
  return task.recurrence && !task.occurrenceDate
    ? task.completeInstances.includes(occurrenceDate ?? todayString())
    : task.completed;
}

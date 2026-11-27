import { normalizeTaskDateTime, taskDatePart, todayString } from "./task";
import type { TaskSummary, UpdateTaskInput } from "./task";

/**
 * Move a TaskNotes date or datetime by whole local calendar days while
 * preserving its displayed wall time across offset and DST changes.
 */
export function shiftTaskDate(
  value: string,
  days: number,
  timezone?: string,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(taskDatePart(value, timezone));
  if (!match) return value;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  if (
    Number.isNaN(date.valueOf()) ||
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  )
    return value;
  date.setDate(date.getDate() + days);
  const shifted = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  return setTaskDate(value, shifted, timezone);
}

/** Rebase a date/datetime onto a local calendar day, preserving wall time. */
export function setTaskDate(
  value: string | undefined,
  targetDate: string,
  timezone?: string,
): string {
  const time = normalizeTaskDateTime(value, timezone)?.match(
    /T(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/,
  )?.[1];
  return time ? `${targetDate}T${time}` : targetDate;
}

/**
 * Moves the plan without changing a deadline unless explicitly requested.
 */
export function rescheduleInput(
  task: Pick<TaskSummary, "scheduled" | "due" | "timezone">,
  date: string,
  today = todayString(new Date(), task.timezone),
  moveDeadlines = false,
): Pick<UpdateTaskInput, "scheduled" | "due"> {
  const due = taskDatePart(task.due, task.timezone);
  return {
    scheduled: setTaskDate(task.scheduled, date, task.timezone),
    ...(moveDeadlines && due && due < today && date >= today
      ? { due: setTaskDate(task.due, date, task.timezone) }
      : {}),
  };
}

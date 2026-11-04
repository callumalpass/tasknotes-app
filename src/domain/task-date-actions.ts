import { taskDatePart, todayString } from "./task";
import type { TaskSummary, UpdateTaskInput } from "./task";

/**
 * Move a TaskNotes date or datetime by whole local calendar days while
 * preserving its displayed wall time across offset and DST changes.
 */
export function shiftTaskDate(value: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(taskDatePart(value));
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
  return setTaskDate(value, shifted);
}

/** Rebase a date/datetime onto a local calendar day, preserving wall time. */
export function setTaskDate(
  value: string | undefined,
  targetDate: string,
): string {
  if (!value || !/[T ]\d{2}:\d{2}/.test(value)) return targetDate;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const time = value.match(/[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/)?.[1];
    return time ? `${targetDate}T${time}` : targetDate;
  }
  const target = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDate);
  const instant = new Date(value);
  if (!target || Number.isNaN(instant.valueOf())) return targetDate;
  instant.setFullYear(
    Number(target[1]),
    Number(target[2]) - 1,
    Number(target[3]),
  );
  return instant.toISOString().replace(".000Z", "Z");
}

/**
 * Moves a task's plan to a day. A deadline already missed moves with it: the
 * person has decided when the work happens, and leaving the old date would
 * keep the task overdue wherever it was sent. A future deadline stays put.
 */
export function rescheduleInput(
  task: Pick<TaskSummary, "scheduled" | "due">,
  date: string,
  today = todayString(),
): Pick<UpdateTaskInput, "scheduled" | "due"> {
  const due = taskDatePart(task.due);
  return {
    scheduled: setTaskDate(task.scheduled, date),
    ...(due && due < today && date >= today
      ? { due: setTaskDate(task.due, date) }
      : {}),
  };
}

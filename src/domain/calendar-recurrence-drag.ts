import { taskDatePart, todayString } from "./task";

import type { Task, UpdateTaskInput } from "./task";

export interface RecurringCalendarDrop {
  occurrenceDate: string;
  recurringKind: "next-scheduled" | "pattern";
  dateField: "scheduled" | "due";
  start: Date;
  allDay: boolean;
}

/**
 * Match TaskNotes' calendar distinction between the concrete next item and
 * virtual pattern previews. Virtual drops never create occurrence notes.
 */
export function planRecurringCalendarDrop(
  task: Task,
  drop: RecurringCalendarDrop,
): UpdateTaskInput {
  if (drop.recurringKind === "next-scheduled") {
    return {
      [drop.dateField]: calendarStorageValue(drop.start, drop.allDay),
    };
  }

  if (!task.recurrence)
    throw new Error("The task does not have a recurrence pattern.");

  const recurrence = updatePatternStart(task, drop.start, drop.allDay);
  if (!recurrence)
    throw new Error("The recurrence pattern has no usable start date.");
  return { recurrence, preserveRecurrenceSchedule: true };
}

function updatePatternStart(
  task: Task,
  draggedStart: Date,
  allDay: boolean,
): string | null {
  const recurrence = task.recurrence;
  if (!recurrence) return null;
  const match = /DTSTART([:=])(\d{8})(?:T\d{6}Z?)?/.exec(recurrence);
  if (!match) {
    const sourceDate = taskDatePart(
      task.scheduled ?? task.createdAt,
    ).replaceAll("-", "");
    if (!/^\d{8}$/.test(sourceDate)) return null;
    const value = allDay
      ? sourceDate
      : `${sourceDate}T${draggedTime(draggedStart)}00Z`;
    return `DTSTART:${value};${recurrence}`;
  }

  const [, separator, date] = match;
  const value = allDay ? date : `${date}T${draggedTime(draggedStart)}00Z`;
  return recurrence.replace(match[0], `DTSTART${separator}${value}`);
}

function draggedTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function calendarStorageValue(date: Date, allDay: boolean): string {
  if (allDay) return todayString(date);
  return `${todayString(date)}T${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

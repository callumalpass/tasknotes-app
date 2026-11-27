import { calendarDateToInstant } from "@tasknotes/model/calendar";
import { runtimeTimezone } from "./runtime-timezone";
import { dateFromStorage, normalizeTaskDateTime } from "./task";
import type { TaskSummary, TaskReminder } from "./task";

export type ReminderOffsetUnit = "minutes" | "hours" | "days";
export type ReminderOffsetDirection = "before" | "after";

export interface EditableReminderOffset {
  amount: number;
  unit: ReminderOffsetUnit;
  direction: ReminderOffsetDirection;
}

export function reminderOffset({
  amount,
  unit,
  direction,
}: EditableReminderOffset): string {
  const normalized = Math.max(0, Math.trunc(amount));
  const duration =
    unit === "days"
      ? `P${normalized}D`
      : unit === "hours"
        ? `PT${normalized}H`
        : `PT${normalized}M`;
  return direction === "before" ? `-${duration}` : duration;
}

export function editableReminderOffset(value?: string): EditableReminderOffset {
  const match = /^(-)?P(?:(\d+)D|T(?:(\d+)H|(\d+)M))$/i.exec(
    value?.trim() ?? "",
  );
  if (!match) return { amount: 15, unit: "minutes", direction: "before" };
  return {
    direction: match[1] ? "before" : "after",
    amount: Number(match[2] ?? match[3] ?? match[4]),
    unit: match[2] ? "days" : match[3] ? "hours" : "minutes",
  };
}

/**
 * The notification text a quick reminder is created with ("15 minutes before",
 * "1 hour before"). It is stored task data, so it stays English and
 * untranslated; the editor rewrites it only while it still matches the offset.
 */
export function generatedReminderDescription(offset?: string): string {
  const { amount, unit, direction } = editableReminderOffset(offset);
  const noun = unit.slice(0, -1);
  return `${amount} ${amount === 1 ? noun : unit} ${direction}`;
}

export function reminderFireTime(
  task: Pick<TaskSummary, "due" | "scheduled" | "timezone">,
  reminder: TaskReminder,
): string | undefined {
  if (reminder.type === "absolute") return validInstant(reminder.absoluteTime);
  const anchor =
    reminder.relatedTo === "due"
      ? task.due
      : reminder.relatedTo === "scheduled"
        ? task.scheduled
        : undefined;
  if (!anchor || !reminder.offset) return undefined;
  const duration = parseDuration(reminder.offset);
  if (!duration) return undefined;
  const zone = task.timezone ?? runtimeTimezone();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(anchor);
  const date = dateFromStorage(dateOnly ? `${anchor}T00:00` : anchor, zone);
  if (!date) return undefined;
  const direction = duration.negative ? -1 : 1;
  let timestamp = date.getTime();
  if (duration.years || duration.months || duration.weeks || duration.days) {
    const wall = normalizeTaskDateTime(anchor, zone)!;
    const shifted = new Date(dateOnly ? `${wall}T00:00:00Z` : `${wall}Z`);
    shifted.setUTCFullYear(
      shifted.getUTCFullYear() + direction * duration.years,
    );
    shifted.setUTCMonth(shifted.getUTCMonth() + direction * duration.months);
    shifted.setUTCDate(
      shifted.getUTCDate() + direction * (duration.weeks * 7 + duration.days),
    );
    if (!Number.isFinite(shifted.getTime())) return undefined;
    timestamp = calendarDateToInstant(shifted.toISOString().slice(0, -1), zone);
  }
  const fireAt = new Date(
    timestamp +
      direction *
        (duration.hours * 3_600_000 +
          duration.minutes * 60_000 +
          duration.seconds * 1_000),
  );
  return Number.isNaN(fireAt.valueOf()) ? undefined : fireAt.toISOString();
}

function validInstant(value?: string): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined;
}

function parseDuration(value: string):
  | {
      negative: boolean;
      years: number;
      months: number;
      weeks: number;
      days: number;
      hours: number;
      minutes: number;
      seconds: number;
    }
  | undefined {
  const match =
    /^([+-])?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(
      value.trim(),
    );
  if (!match || !match.slice(2).some((entry) => entry !== undefined))
    return undefined;
  return {
    negative: match[1] === "-",
    years: Number(match[2] ?? 0),
    months: Number(match[3] ?? 0),
    weeks: Number(match[4] ?? 0),
    days: Number(match[5] ?? 0),
    hours: Number(match[6] ?? 0),
    minutes: Number(match[7] ?? 0),
    seconds: Number(match[8] ?? 0),
  };
}

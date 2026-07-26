import type { Task, TaskReminder } from "./task";

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

export function reminderFireTime(
  task: Pick<Task, "due" | "scheduled">,
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
  const date = dateFromTaskValue(anchor);
  const duration = parseDuration(reminder.offset);
  if (!date || !duration) return undefined;
  const direction = duration.negative ? -1 : 1;
  date.setFullYear(date.getFullYear() + direction * duration.years);
  date.setMonth(date.getMonth() + direction * duration.months);
  date.setDate(
    date.getDate() + direction * (duration.weeks * 7 + duration.days),
  );
  date.setTime(
    date.getTime() +
      direction *
        (duration.hours * 3_600_000 +
          duration.minutes * 60_000 +
          duration.seconds * 1_000),
  );
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function validInstant(value?: string): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined;
}

function dateFromTaskValue(value: string): Date | undefined {
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value,
  );
  return Number.isNaN(date.valueOf()) ? undefined : date;
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

import { plural, selectOrdinal, t } from "@lingui/core/macro";
import { appLocale } from "./app";
import {
  dateFromStorage,
  taskDatePart,
  taskTimePart,
  todayString,
  isTaskDateOverdue,
  type TaskSummary,
} from "../domain/task";
import type {
  RecurrenceRuleDraft,
  RecurrenceWeekday,
} from "../domain/recurrence-rule";

// Presentation lives here; domain parsing, storage keys and record values stay language-neutral.
export function formatTaskDate(value: string, today = todayString()): string {
  const datePart = taskDatePart(value);
  const timePart = taskTimePart(value);
  const timeLabel = timePart ? `, ${formatTaskTime(timePart)}` : "";
  if (datePart === today) return `${t`Today`}${timeLabel}`;
  const date = dateFromStorage(value);
  if (!date) return value;
  const tomorrow = dateFromStorage(today) ?? new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (datePart === todayString(tomorrow)) return `${t`Tomorrow`}${timeLabel}`;
  const label = new Intl.DateTimeFormat(appLocale(), {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
  return `${label}${timeLabel}`;
}

export function formatRelativeTaskDate(
  value: string,
  today = todayString(),
): string {
  const date = dateFromStorage(taskDatePart(value));
  const todayDate = dateFromStorage(today);
  if (!date || !todayDate) return value;
  const days = Math.round((date.getTime() - todayDate.getTime()) / 86_400_000);
  const timePart = days < 0 ? "" : taskTimePart(value);
  const timeLabel = timePart ? `, ${formatTaskTime(timePart)}` : "";
  const count = -days;
  const label =
    days === 0
      ? t`Today`
      : days === -1
        ? t`Yesterday`
        : days === 1
          ? t`Tomorrow`
          : days < 0 && days >= -6
            ? plural(count, { one: "# day ago", other: "# days ago" })
            : days > 0 && days <= 6
              ? new Intl.DateTimeFormat(appLocale(), {
                  weekday: "short",
                }).format(date)
              : new Intl.DateTimeFormat(appLocale(), {
                  day: "numeric",
                  month: "short",
                  year:
                    date.getFullYear() === todayDate.getFullYear()
                      ? undefined
                      : "numeric",
                }).format(date);
  return `${label}${timeLabel}`;
}

function formatTaskTime(value: string): string {
  const [hours, minutes] = value.split(":").map(Number);
  return new Intl.DateTimeFormat(appLocale(), {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2024, 0, 1, hours, minutes));
}

export function taskMeta(
  task: TaskSummary,
  today = todayString(),
): { label: string; overdue?: boolean }[] {
  const values: { label: string; overdue?: boolean }[] = [];
  if (task.scheduled)
    values.push({
      label: formatTaskDate(task.scheduled, today),
      overdue: !task.completed && isTaskDateOverdue(task.scheduled),
    });
  else if (task.due)
    values.push({
      label: t`Due ${formatTaskDate(task.due, today)}`,
      overdue: !task.completed && isTaskDateOverdue(task.due),
    });
  if (task.priority !== "none" && task.priority !== "normal")
    values.push({ label: task.priority });
  if (task.recurrence) values.push({ label: recurrenceLabel(task.recurrence) });
  return values;
}

export function recurrenceLabel(value: string): string {
  const rule = value.toUpperCase();
  if (rule.includes("FREQ=DAILY") && rule.includes("BYDAY=MO,TU,WE,TH,FR"))
    return t`Weekdays`;
  if (rule.includes("FREQ=DAILY")) return t`Daily`;
  if (rule.includes("FREQ=WEEKLY")) return t`Weekly`;
  if (rule.includes("FREQ=MONTHLY")) return t`Monthly`;
  if (rule.includes("FREQ=YEARLY")) return t`Yearly`;
  return t`Repeats`;
}

const weekdays: RecurrenceWeekday[] = [
  "MO",
  "TU",
  "WE",
  "TH",
  "FR",
  "SA",
  "SU",
];
export function weekdayName(
  value: RecurrenceWeekday,
  width: "long" | "narrow" = "long",
): string {
  return new Intl.DateTimeFormat(appLocale(), { weekday: width }).format(
    new Date(2024, 0, 1 + weekdays.indexOf(value)),
  );
}
export function monthName(value: number): string {
  return new Intl.DateTimeFormat(appLocale(), { month: "long" }).format(
    new Date(2024, Math.max(0, Math.min(11, value - 1)), 1),
  );
}
export function ordinal(value: number): string {
  return selectOrdinal(value, {
    one: "#st",
    two: "#nd",
    few: "#rd",
    other: "#th",
  });
}
function monthDay(value: number): string {
  if (value === -1) return t`last day`;
  if (value < 0) {
    const count = Math.abs(value);
    return plural(count, {
      one: "# day from the end",
      other: "# days from the end",
    });
  }
  return ordinal(value);
}
function position(value: number): string {
  switch (value) {
    case 2:
      return t`second`;
    case 3:
      return t`third`;
    case 4:
      return t`fourth`;
    case -1:
      return t`last`;
    default:
      return t`first`;
  }
}

export function recurrenceRuleSummary(draft: RecurrenceRuleDraft): string {
  if (draft.invalid.length) return t`Invalid recurrence rule`;
  if (draft.unsupported.length) return t`Advanced recurrence rule`;
  const interval = Math.max(1, Math.round(draft.interval));
  let summary: string;
  switch (draft.frequency) {
    case "DAILY":
      summary = plural(interval, { one: "Every day", other: "Every # days" });
      break;
    case "WEEKLY":
      summary = plural(interval, { one: "Every week", other: "Every # weeks" });
      break;
    case "MONTHLY":
      summary = plural(interval, {
        one: "Every month",
        other: "Every # months",
      });
      break;
    case "YEARLY":
      summary = plural(interval, { one: "Every year", other: "Every # years" });
      break;
  }
  if (
    (draft.frequency === "DAILY" || draft.frequency === "WEEKLY") &&
    draft.weekdays.length
  ) {
    const names = new Intl.ListFormat(appLocale(), {
      style: "long",
      type: "conjunction",
    }).format(
      weekdays
        .filter((day) => draft.weekdays.includes(day))
        .map((day) => weekdayName(day)),
    );
    summary = t`${summary} on ${names}`;
  }
  if (
    (draft.frequency === "MONTHLY" || draft.frequency === "YEARLY") &&
    draft.pattern === "date"
  ) {
    const day = monthDay(draft.monthDay);
    summary = t`${summary} on the ${day}`;
  }
  if (
    (draft.frequency === "MONTHLY" || draft.frequency === "YEARLY") &&
    draft.pattern === "weekday"
  ) {
    const rank = position(draft.position);
    const day = weekdayName(draft.weekdays[0] ?? "MO");
    summary = t`${summary} on the ${rank} ${day}`;
  }
  if (draft.frequency === "YEARLY") {
    const month = monthName(draft.month);
    summary = t`${summary} of ${month}`;
  }
  if (draft.end === "count" && draft.count) {
    const count = draft.count;
    const ending = plural(count, { one: "# time", other: "# times" });
    summary = t`${summary}, ${ending}`;
  } else if (draft.end === "until" && draft.until) {
    const until = new Intl.DateTimeFormat(appLocale(), {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(`${draft.until}T00:00:00`));
    summary = t`${summary}, until ${until}`;
  }
  return summary;
}

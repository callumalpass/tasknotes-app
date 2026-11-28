import {
  calendarDateToInstant,
  calendarInstantToDate,
} from "@tasknotes/model/calendar";
import { runtimeTimezone } from "./runtime-timezone";
import type {
  TaskDependency,
  TaskDependencyRelType,
} from "@tasknotes/model/types";

export type { TaskDependency, TaskDependencyRelType };

export type TaskStatus = string;
export type TaskPriority = string;

export interface TaskReminder {
  id: string;
  type: "absolute" | "relative";
  relatedTo?: "due" | "scheduled";
  offset?: string;
  absoluteTime?: string;
  description?: string;
}

export interface TaskTimeEntry {
  startTime: string;
  endTime?: string;
  description?: string;
}

/** Metadata projection. It cannot be used as a complete editable document. */
export interface TaskSummary {
  id: string;
  path: string;
  title: string;
  status: TaskStatus;
  completed: boolean;
  archived: boolean;
  priority: TaskPriority;
  timezone?: string;
  due?: string;
  scheduled?: string;
  createdAt: string;
  updatedAt: string;
  completedDate?: string;
  tags: string[];
  contexts: string[];
  projects: string[];
  /** Links to person records, resolved by mdbase; unresolved links are preserved. */
  assignees?: string[];
  /** Canonical frontmatter links that define attachment membership. */
  attachments: string[];
  blockedBy: TaskDependency[];
  recurrence?: string;
  recurrenceAnchor?: "scheduled" | "completion";
  occurrenceMaterialization?: "manual" | "on_completion" | "rolling";
  occurrenceNextTrigger?: "completion" | "completion_or_skip";
  occurrenceTemplate?: string;
  occurrencePastHorizon?: string;
  occurrenceFutureHorizon?: string;
  recurrenceParent?: string;
  occurrenceDate?: string;
  skipped?: boolean;
  completeInstances: string[];
  skippedInstances: string[];
  reminders: TaskReminder[];
  timeEstimate?: number;
  sortOrder?: string;
  timeEntries: TaskTimeEntry[];
  customProperties: Record<string, unknown>;
  operationWarnings?: string[];
  revision: number;
  recordVersion?: string;
  frontmatter: Record<string, unknown>;
}

/** A fully hydrated task; even an empty body has been read from authority. */
export interface Task extends TaskSummary {
  body: string;
}

export interface TaskSearchResult {
  task: TaskSummary;
  /** Normalized query tokens observed in the body by the authority. */
  bodyMatches: string[];
}

export function summarizeTask(task: Task): TaskSummary {
  const { body, ...summary } = task;
  void body;
  return summary;
}

export interface CreateTaskInput {
  assignees?: string[];
  title: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  due?: string;
  scheduled?: string;
  body?: string;
  tags?: string[];
  contexts?: string[];
  projects?: string[];
  attachments?: string[];
  blockedBy?: TaskDependency[];
  recurrence?: string;
  recurrenceAnchor?: "scheduled" | "completion";
  occurrenceMaterialization?: "manual" | "on_completion" | "rolling";
  occurrenceNextTrigger?: "completion" | "completion_or_skip";
  occurrenceTemplate?: string;
  occurrencePastHorizon?: string;
  occurrenceFutureHorizon?: string;
  reminders?: TaskReminder[];
  timeEstimate?: number;
  sortOrder?: string;
  customProperties?: Record<string, unknown>;
  parentNote?: string;
  useTemplate?: boolean;
}

export interface UpdateTaskInput {
  assignees?: string[];
  title?: string;
  status?: TaskStatus;
  completed?: boolean;
  archived?: boolean;
  priority?: TaskPriority;
  due?: string | null;
  scheduled?: string | null;
  body?: string;
  tags?: string[];
  contexts?: string[];
  projects?: string[];
  attachments?: string[];
  blockedBy?: TaskDependency[];
  recurrence?: string | null;
  recurrenceAnchor?: "scheduled" | "completion";
  occurrenceMaterialization?: "manual" | "on_completion" | "rolling";
  occurrenceNextTrigger?: "completion" | "completion_or_skip";
  occurrenceTemplate?: string | null;
  occurrencePastHorizon?: string | null;
  occurrenceFutureHorizon?: string | null;
  reminders?: TaskReminder[];
  timeEstimate?: number | null;
  sortOrder?: string | null;
  timeEntries?: TaskTimeEntry[];
  customProperties?: Record<string, unknown>;
  /** Editor changes to individual properties. Null clears the named property. */
  customPropertyPatch?: Record<string, unknown>;
  /** Keep concrete execution dates unchanged during a pattern-only RRULE edit. */
  preserveRecurrenceSchedule?: boolean;
}

export interface TaskTimeTotals {
  closedMinutes: number;
  liveMinutes: number;
}

/** Task detail surfaces report live minutes; historical rows report closed minutes. */
export function taskTimeTotals(
  entries: readonly TaskTimeEntry[] | undefined,
  now = new Date(),
): TaskTimeTotals {
  let closedMinutes = 0;
  let liveMinutes = 0;
  for (const entry of entries ?? []) {
    const start = new Date(entry.startTime).getTime();
    const end = entry.endTime
      ? new Date(entry.endTime).getTime()
      : now.getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
      continue;
    const minutes = Math.round((end - start) / 60_000);
    liveMinutes += minutes;
    if (entry.endTime) closedMinutes += minutes;
  }
  return { closedMinutes, liveMinutes };
}

export function activeTimeEntry(
  entries: readonly TaskTimeEntry[] | undefined,
): TaskTimeEntry | undefined {
  return entries?.find((entry) => !entry.endTime);
}

export interface TaskListQuery {
  /**
   * A person record path: keeps tasks whose assignee links resolve to it,
   * before sorting and pagination. Only repositories exposing `people` support it.
   */
  assignedTo?: string;
  status?: "open" | "completed" | "all";
  archived?: "exclude" | "only" | "include";
  search?: string;
  limit?: number;
}

export interface TaskStats {
  total: number;
  open: number;
  completed: number;
  archived: number;
}

export interface MaterializeOccurrenceResult {
  task: Task;
  created: boolean;
  warnings: string[];
}

export function todayString(now = new Date(), timezone?: string): string {
  if (timezone) return calendarInstantToDate(now.getTime(), timezone, true);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatTaskDate(
  value: string,
  today = todayString(),
  timezone?: string,
): string {
  const datePart = taskDatePart(value, timezone);
  const timePart = taskTimePart(value, timezone);
  const timeLabel = timePart ? `, ${formatTaskTime(timePart)}` : "";
  if (datePart === today) return `Today${timeLabel}`;
  const date = dateFromStorage(datePart);
  if (!date) return value;
  const todayDate = dateFromStorage(today) ?? new Date();
  const tomorrow = new Date(todayDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (datePart === todayString(tomorrow)) return `Tomorrow${timeLabel}`;
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
  return `${dateLabel}${timeLabel}`;
}

/**
 * Compact list label: nearby days read relative to today ("Yesterday",
 * "3 days ago", "Sat"); other dates use a short month and day. Times are
 * kept for today and future dates only.
 */
export function formatRelativeTaskDate(
  value: string,
  today = todayString(),
  timezone?: string,
): string {
  const datePart = taskDatePart(value, timezone);
  const date = dateFromStorage(datePart);
  const todayDate = dateFromStorage(today);
  if (!date || !todayDate) return value;
  const days = Math.round((date.getTime() - todayDate.getTime()) / 86_400_000);
  // A past day's time no longer helps scanning, so compact rows omit it.
  const timePart = days < 0 ? "" : taskTimePart(value, timezone);
  const timeLabel = timePart ? `, ${formatTaskTime(timePart)}` : "";
  const dateLabel =
    days === 0
      ? "Today"
      : days === -1
        ? "Yesterday"
        : days === 1
          ? "Tomorrow"
          : days < 0 && days >= -6
            ? `${-days} days ago`
            : days > 0 && days <= 6
              ? new Intl.DateTimeFormat(undefined, {
                  weekday: "short",
                }).format(date)
              : new Intl.DateTimeFormat(undefined, {
                  day: "numeric",
                  month: "short",
                  year:
                    date.getFullYear() === todayDate.getFullYear()
                      ? undefined
                      : "numeric",
                }).format(date);
  return `${dateLabel}${timeLabel}`;
}

const offsetDateTime = /T.*(?:Z|[+-]\d{2}:\d{2})$/i;
const floatingDateTime =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

export function dateFromStorage(value: string, timezone?: string): Date | null {
  if (offsetDateTime.test(value)) {
    const instant = new Date(value);
    return Number.isNaN(instant.valueOf()) ? null : instant;
  }
  if (floatingDateTime.test(value)) {
    try {
      return new Date(
        calendarDateToInstant(
          value.replace(" ", "T").replace(/(\.\d{3})\d+$/, "$1"),
          timezone ?? runtimeTimezone(),
        ),
      );
    } catch {
      return null;
    }
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(0);
  date.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setHours(0, 0, 0, 0);
  return date.getFullYear() === Number(match[1]) &&
    date.getMonth() === Number(match[2]) - 1 &&
    date.getDate() === Number(match[3])
    ? date
    : null;
}

export function taskDatePart(value?: string, timezone?: string): string {
  if (!value) return "";
  if (offsetDateTime.test(value)) {
    const instant = dateFromStorage(value);
    return instant ? todayString(instant, timezone) : "";
  }
  return value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

export function taskTimePart(value?: string, timezone?: string): string {
  if (!value) return "";
  if (offsetDateTime.test(value)) {
    const instant = dateFromStorage(value);
    return instant
      ? calendarInstantToDate(
          instant.getTime(),
          timezone ?? runtimeTimezone(),
        ).slice(11)
      : "";
  }
  return value.match(/(?:T| )(\d{2}:\d{2})/)?.[1] ?? "";
}

export function combineTaskDateTime(
  date?: string,
  time?: string,
): string | undefined {
  if (!date) return undefined;
  return time
    ? `${taskDatePart(date) || date}T${time}`
    : taskDatePart(date) || date;
}

/** Where an open task stands against one day. */
export type TaskDayStanding = "overdue" | "today" | "later" | "anytime";

/**
 * The one reading of "overdue" that Today, Upcoming and the sidebar share. A
 * past Scheduled or Due date makes a task overdue, except that scheduling it
 * for today is the person's answer to that: it then belongs to today, though
 * its row still shows the deadline it missed.
 */
export function taskDayStanding(
  task: Pick<TaskSummary, "scheduled" | "due" | "timezone">,
  today: string,
): TaskDayStanding {
  const scheduled = taskDatePart(task.scheduled, task.timezone);
  const due = taskDatePart(task.due, task.timezone);
  if (scheduled === today) return "today";
  if ((scheduled && scheduled < today) || (due && due < today))
    return "overdue";
  const date = scheduled || due;
  if (!date) return "anytime";
  return date === today ? "today" : "later";
}

/** A due date that has passed, even when the task is planned for today. */
export function isTaskPastDue(
  task: Pick<TaskSummary, "due" | "timezone">,
  today: string,
): boolean {
  const due = taskDatePart(task.due, task.timezone);
  return Boolean(due && due < today);
}

export function isTaskDateOverdue(
  value: string,
  now = new Date(),
  timezone?: string,
): boolean {
  const date = dateFromStorage(value, timezone);
  if (!date) return false;
  if (taskTimePart(value, timezone)) return date.getTime() < now.getTime();
  return taskDatePart(value, timezone) < todayString(now, timezone);
}

/** A due or scheduled edit stores the collection wall time. */
export function normalizeTaskDateTime(
  value?: string,
  timezone?: string,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (floatingDateTime.test(trimmed)) return trimmed.replace(" ", "T");
  if (!offsetDateTime.test(trimmed)) return trimmed;
  const instant = dateFromStorage(trimmed);
  if (!instant) return trimmed;
  const zone = timezone ?? runtimeTimezone();
  const second = new Intl.DateTimeFormat("en", {
    timeZone: zone,
    second: "2-digit",
  })
    .format(instant)
    .padStart(2, "0");
  const fraction = instant.toISOString().slice(19, 23);
  return `${calendarInstantToDate(instant.getTime(), zone)}:${second}${fraction === ".000" ? "" : fraction}`;
}

/** Resolve a timestamp read from properties without changing persisted bytes. */
export function readTaskInstant(
  value?: string,
  timezone?: string,
): string | undefined {
  if (!value || !floatingDateTime.test(value)) return value;
  return dateFromStorage(value, timezone)?.toISOString() ?? value;
}

function formatTaskTime(value: string): string {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date(2024, 0, 1, hours, minutes);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function taskMeta(
  task: TaskSummary,
  today = todayString(new Date(), task.timezone),
): { label: string; overdue?: boolean }[] {
  const values: { label: string; overdue?: boolean }[] = [];
  if (task.scheduled) {
    values.push({
      label: formatTaskDate(task.scheduled, today, task.timezone),
    });
  } else if (task.due) {
    values.push({
      label: `Due ${formatTaskDate(task.due, today, task.timezone)}`,
      overdue:
        !task.completed &&
        isTaskDateOverdue(task.due, undefined, task.timezone),
    });
  }
  if (task.priority !== "none" && task.priority !== "normal")
    values.push({ label: task.priority });
  if (task.recurrence) values.push({ label: recurrenceLabel(task.recurrence) });
  return values;
}

export function recurrenceLabel(value: string): string {
  const rule = value.toUpperCase();
  if (rule.includes("FREQ=DAILY") && rule.includes("BYDAY=MO,TU,WE,TH,FR"))
    return "Weekdays";
  if (rule.includes("FREQ=DAILY")) return "Daily";
  if (rule.includes("FREQ=WEEKLY")) return "Weekly";
  if (rule.includes("FREQ=MONTHLY")) return "Monthly";
  if (rule.includes("FREQ=YEARLY")) return "Yearly";
  return "Repeats";
}

export function recurrencePreset(value?: string): string {
  if (!value) return "never";
  const rule = value.toUpperCase();
  if (rule.includes("FREQ=DAILY") && rule.includes("BYDAY=MO,TU,WE,TH,FR"))
    return "weekdays";
  if (rule.includes("FREQ=DAILY")) return "daily";
  if (rule.includes("FREQ=WEEKLY")) return "weekly";
  if (rule.includes("FREQ=MONTHLY")) return "monthly";
  if (rule.includes("FREQ=YEARLY")) return "yearly";
  return "custom";
}

export function makeTaskPath(
  title: string,
  id: string,
  recordsFolder = "tasks",
): string {
  if (!title.trim()) throw new Error("A task title is required.");
  const folder = recordsFolder.replace(/^\/+|\/+$/g, "") || "tasks";
  return `${folder}/${id}.md`;
}

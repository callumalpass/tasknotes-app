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

export interface Task {
  id: string;
  path: string;
  title: string;
  status: TaskStatus;
  completed: boolean;
  archived: boolean;
  priority: TaskPriority;
  due?: string;
  scheduled?: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  completedDate?: string;
  tags: string[];
  contexts: string[];
  projects: string[];
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
  frontmatter: Record<string, unknown>;
}

export interface CreateTaskInput {
  title: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  due?: string;
  scheduled?: string;
  body?: string;
  tags?: string[];
  contexts?: string[];
  projects?: string[];
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

export function todayString(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatTaskDate(value: string, today = todayString()): string {
  const datePart = taskDatePart(value);
  const timePart = taskTimePart(value);
  const timeLabel = timePart ? `, ${formatTaskTime(timePart)}` : "";
  if (datePart === today) return `Today${timeLabel}`;
  const date = dateFromStorage(value);
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

export function dateFromStorage(value: string): Date | null {
  if (/T/.test(value) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const instant = new Date(value);
    return Number.isNaN(instant.valueOf()) ? null : instant;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
  );
  if (
    Number.isNaN(date.valueOf()) ||
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  )
    return null;
  return date;
}

export function taskDatePart(value?: string): string {
  if (!value) return "";
  if (/T/.test(value) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const instant = dateFromStorage(value);
    return instant ? todayString(instant) : "";
  }
  return value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

export function taskTimePart(value?: string): string {
  if (!value) return "";
  if (/T/.test(value) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const instant = dateFromStorage(value);
    return instant
      ? `${String(instant.getHours()).padStart(2, "0")}:${String(instant.getMinutes()).padStart(2, "0")}`
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

export function isTaskDateOverdue(value: string, now = new Date()): boolean {
  const date = dateFromStorage(value);
  if (!date) return false;
  if (taskTimePart(value)) return date.getTime() < now.getTime();
  return taskDatePart(value) < todayString(now);
}

export function normalizeTaskDateTime(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const instant = new Date(trimmed);
  if (Number.isNaN(instant.valueOf())) return trimmed;
  return instant.toISOString().replace(".000Z", "Z");
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
  task: Task,
  today = todayString(),
): { label: string; overdue?: boolean }[] {
  const values: { label: string; overdue?: boolean }[] = [];
  if (task.scheduled) {
    values.push({
      label: formatTaskDate(task.scheduled, today),
      overdue: !task.completed && isTaskDateOverdue(task.scheduled),
    });
  } else if (task.due) {
    values.push({
      label: `Due ${formatTaskDate(task.due, today)}`,
      overdue: !task.completed && isTaskDateOverdue(task.due),
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

export function recurrenceRule(value: string): string | undefined {
  return {
    daily: "FREQ=DAILY;INTERVAL=1",
    weekdays: "FREQ=DAILY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR",
    weekly: "FREQ=WEEKLY;INTERVAL=1",
    monthly: "FREQ=MONTHLY;INTERVAL=1",
    yearly: "FREQ=YEARLY;INTERVAL=1",
  }[value];
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

export function normalizeSearchQuery(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/["*:^(){}[\]]/g, ""))
    .filter(Boolean)
    .map((token) => `"${token}"*`)
    .join(" AND ");
}

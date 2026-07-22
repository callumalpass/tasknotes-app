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

export interface Task {
  id: string;
  path: string;
  title: string;
  status: TaskStatus;
  completed: boolean;
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
  recurrence?: string;
  recurrenceAnchor?: "scheduled" | "completion";
  completeInstances: string[];
  skippedInstances: string[];
  reminders: TaskReminder[];
  revision: number;
  frontmatter: Record<string, unknown>;
}

export interface CreateTaskInput {
  title: string;
  priority?: TaskPriority;
  due?: string;
  scheduled?: string;
  body?: string;
  tags?: string[];
  contexts?: string[];
  projects?: string[];
  recurrence?: string;
  recurrenceAnchor?: "scheduled" | "completion";
  reminders?: TaskReminder[];
}

export interface UpdateTaskInput {
  title?: string;
  status?: TaskStatus;
  completed?: boolean;
  priority?: TaskPriority;
  due?: string | null;
  scheduled?: string | null;
  body?: string;
  tags?: string[];
  contexts?: string[];
  projects?: string[];
  recurrence?: string | null;
  recurrenceAnchor?: "scheduled" | "completion";
  reminders?: TaskReminder[];
}

export interface TaskListQuery {
  status?: "open" | "completed" | "all";
  search?: string;
  limit?: number;
}

export interface TaskStats {
  total: number;
  open: number;
  completed: number;
}

export function todayString(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatTaskDate(value: string, today = todayString()): string {
  if (value === today) return "Today";
  const date = dateFromStorage(value);
  if (!date) return value;
  const todayDate = dateFromStorage(today) ?? new Date();
  const tomorrow = new Date(todayDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (value === todayString(tomorrow)) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

export function dateFromStorage(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
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
    return null;
  return date;
}

export function taskMeta(
  task: Task,
  today = todayString(),
): { label: string; overdue?: boolean }[] {
  const values: { label: string; overdue?: boolean }[] = [];
  if (task.scheduled) {
    values.push({
      label: formatTaskDate(task.scheduled, today),
      overdue: !task.completed && task.scheduled < today,
    });
  } else if (task.due) {
    values.push({
      label: `Due ${formatTaskDate(task.due, today)}`,
      overdue: !task.completed && task.due < today,
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

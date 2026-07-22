import { generateRecurringInstances } from "@tasknotes/model/recurrence";

import {
  combineTaskDateTime,
  dateFromStorage,
  taskDatePart,
  taskTimePart,
  todayString,
  type Task,
} from "./task";

export interface TaskOccurrence {
  key: string;
  task: Task;
  date: string;
  completed: boolean;
  skipped: boolean;
}

export interface TaskOccurrenceEntry {
  key: string;
  task: Task;
  occurrence?: TaskOccurrence;
  date: string;
}

export interface TodayTaskProjection {
  overdue: TaskOccurrenceEntry[];
  today: TaskOccurrenceEntry[];
  inbox: TaskOccurrenceEntry[];
  shownCount: number;
  totalCount: number;
}

export interface UpcomingTaskProjection {
  groups: { date: string; tasks: TaskOccurrenceEntry[]; totalCount: number }[];
  shownCount: number;
  totalCount: number;
}

const RECURRENCE_CACHE_LIMIT = 2_048;
const recurrenceDateCache = new Map<string, readonly string[]>();

export function taskOccurrencesBetween(
  task: Task,
  start: string,
  end: string,
): TaskOccurrence[] {
  if (!task.recurrence) return [];
  return recurringDatesBetween(task, start, end).map((date) =>
    occurrence(task, date),
  );
}

function recurringDatesBetween(
  task: Task,
  start: string,
  end: string,
): readonly string[] {
  const startDate = utcStorageDate(start);
  const endDate = utcStorageDate(end);
  if (!startDate || !endDate || startDate > endDate) return [];
  const key = JSON.stringify([
    task.recurrence,
    taskDatePart(task.scheduled ?? task.createdAt),
    start,
    end,
  ]);
  const cached = recurrenceDateCache.get(key);
  if (cached) {
    recurrenceDateCache.delete(key);
    recurrenceDateCache.set(key, cached);
    return cached;
  }
  startDate.setUTCDate(startDate.getUTCDate() - 1);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const dates = generateRecurringInstances(
    {
      title: task.title,
      recurrence: task.recurrence,
      scheduled: task.scheduled,
      dateCreated: task.createdAt,
    },
    startDate,
    endDate,
  )
    .map((date) => todayString(date))
    .filter((date) => date >= start && date <= end);
  recurrenceDateCache.set(key, dates);
  if (recurrenceDateCache.size > RECURRENCE_CACHE_LIMIT) {
    recurrenceDateCache.delete(recurrenceDateCache.keys().next().value!);
  }
  return dates;
}

export function occurrenceTask(value: TaskOccurrence): Task {
  const task = value.task;
  const scheduled = task.scheduled
    ? combineTaskDateTime(value.date, taskTimePart(task.scheduled))
    : undefined;
  const due = task.due
    ? combineTaskDateTime(
        addDays(value.date, dueOffsetDays(task)),
        taskTimePart(task.due),
      )
    : undefined;
  return {
    ...task,
    completed: value.completed,
    scheduled,
    due,
  };
}

export function occurrenceRange(
  daysBefore: number,
  daysAfter: number,
  now = new Date(),
): { start: string; end: string } {
  const start = new Date(now);
  start.setDate(start.getDate() - daysBefore);
  const end = new Date(now);
  end.setDate(end.getDate() + daysAfter);
  return { start: todayString(start), end: todayString(end) };
}

export function projectTodayTasks(
  tasks: Task[],
  start: string,
  today: string,
  perSectionLimit: number,
): TodayTaskProjection {
  const groups = {
    overdue: [] as TaskOccurrenceEntry[],
    today: [] as TaskOccurrenceEntry[],
    inbox: [] as TaskOccurrenceEntry[],
  };
  const counts = { overdue: 0, today: 0, inbox: 0 };
  const append = (entry: TaskOccurrenceEntry) => {
    const group = !entry.date
      ? "inbox"
      : entry.date < today
        ? "overdue"
        : "today";
    counts[group] += 1;
    if (groups[group].length < perSectionLimit) groups[group].push(entry);
  };
  for (const task of tasks) {
    if (task.recurrence) {
      for (const occurrence of taskOccurrencesBetween(task, start, today)) {
        if (!occurrence.completed && !occurrence.skipped)
          append({
            key: occurrence.key,
            task,
            occurrence,
            date: occurrence.date,
          });
      }
      continue;
    }
    const date = taskDatePart(task.scheduled ?? task.due);
    if (!date || date <= today) append({ key: task.id, task, date });
  }
  const shownCount =
    groups.overdue.length + groups.today.length + groups.inbox.length;
  return {
    ...groups,
    shownCount,
    totalCount: counts.overdue + counts.today + counts.inbox,
  };
}

export function projectUpcomingTasks(
  tasks: Task[],
  today: string,
  recurrenceEnd: string,
  limit: number,
): UpcomingTaskProjection {
  const buckets = new Map<
    string,
    { tasks: TaskOccurrenceEntry[]; totalCount: number }
  >();
  const append = (entry: TaskOccurrenceEntry) => {
    const bucket = buckets.get(entry.date) ?? { tasks: [], totalCount: 0 };
    bucket.totalCount += 1;
    if (bucket.tasks.length < limit) bucket.tasks.push(entry);
    buckets.set(entry.date, bucket);
  };
  for (const task of tasks) {
    if (task.recurrence) {
      for (const occurrence of taskOccurrencesBetween(
        task,
        today,
        recurrenceEnd,
      )) {
        if (
          occurrence.date > today &&
          !occurrence.completed &&
          !occurrence.skipped
        )
          append({
            key: occurrence.key,
            task,
            occurrence,
            date: occurrence.date,
          });
      }
      continue;
    }
    const date = taskDatePart(task.scheduled ?? task.due);
    if (date > today) append({ key: task.id, task, date });
  }

  let remaining = limit;
  let shownCount = 0;
  const groups = [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([date, bucket]) => {
      if (remaining <= 0) return [];
      const visible = bucket.tasks.slice(0, remaining);
      remaining -= visible.length;
      shownCount += visible.length;
      return visible.length
        ? [{ date, tasks: visible, totalCount: bucket.totalCount }]
        : [];
    });
  return {
    groups,
    shownCount,
    totalCount: [...buckets.values()].reduce(
      (total, bucket) => total + bucket.totalCount,
      0,
    ),
  };
}

function occurrence(task: Task, date: string): TaskOccurrence {
  return {
    key: `${task.id}:${date}`,
    task,
    date,
    completed: task.completeInstances.includes(date),
    skipped: task.skippedInstances.includes(date),
  };
}

function dueOffsetDays(task: Task): number {
  const scheduled = dateFromStorage(taskDatePart(task.scheduled));
  const due = dateFromStorage(taskDatePart(task.due));
  if (!scheduled || !due) return 0;
  const start = Date.UTC(
    scheduled.getFullYear(),
    scheduled.getMonth(),
    scheduled.getDate(),
  );
  const end = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
  return Math.round((end - start) / 86_400_000);
}

function addDays(value: string, days: number): string {
  const date = dateFromStorage(value);
  if (!date) return value;
  date.setDate(date.getDate() + days);
  return todayString(date);
}

function utcStorageDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
}

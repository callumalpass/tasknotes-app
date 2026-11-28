import { generateRecurringInstances } from "@tasknotes/model/recurrence";
import { normalizeTaskReference } from "@tasknotes/model/operations";
import { shiftTaskDate } from "./task-date-actions";
import {
  parseRecurrenceRule,
  recurrenceStartStorageValue,
} from "./recurrence-rule";

import {
  combineTaskDateTime,
  dateFromStorage,
  normalizeTaskDateTime,
  taskDatePart,
  taskTimePart,
  todayString,
  type TaskSummary,
} from "./task";

export interface TaskOccurrence {
  key: string;
  task: TaskSummary;
  date: string;
  completed: boolean;
  skipped: boolean;
}

export interface TaskOccurrenceEntry {
  key: string;
  task: TaskSummary;
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
  task: TaskSummary,
  start: string,
  end: string,
): TaskOccurrence[] {
  if (!task.recurrence) return [];
  return recurringDatesBetween(task, start, end).map((date) =>
    taskOccurrenceForDate(task, date),
  );
}

export function taskOccurrenceForDate(
  task: TaskSummary,
  date: string,
): TaskOccurrence {
  return {
    key: `${task.id}:${date}`,
    task,
    date,
    completed: task.completeInstances.includes(date),
    skipped: task.skippedInstances.includes(date),
  };
}

function recurringDatesBetween(
  task: TaskSummary,
  start: string,
  end: string,
): readonly string[] {
  const key = JSON.stringify([
    task.recurrence,
    normalizeTaskDateTime(task.scheduled ?? task.createdAt, task.timezone),
    start,
    end,
  ]);
  const cached = recurrenceDateCache.get(key);
  if (cached) {
    recurrenceDateCache.delete(key);
    recurrenceDateCache.set(key, cached);
    return cached;
  }
  const startDate = utcStorageDate(start);
  const endDate = utcStorageDate(end);
  if (!startDate || !endDate || startDate > endDate) return [];
  startDate.setUTCDate(startDate.getUTCDate() - 1);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const dates = generateRecurringInstances(
    {
      title: task.title,
      recurrence: task.recurrence,
      scheduled: normalizeTaskDateTime(task.scheduled, task.timezone),
      dateCreated: normalizeTaskDateTime(task.createdAt, task.timezone),
    },
    startDate,
    endDate,
  )
    .map(utcCalendarDate)
    .filter((date) => date >= start && date <= end);
  recurrenceDateCache.set(key, dates);
  if (recurrenceDateCache.size > RECURRENCE_CACHE_LIMIT) {
    recurrenceDateCache.delete(recurrenceDateCache.keys().next().value!);
  }
  return dates;
}

function utcCalendarDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function occurrenceTask(value: TaskOccurrence): TaskSummary {
  const task = value.task;
  const scheduled = combineTaskDateTime(
    value.date,
    taskTimePart(task.scheduled, task.timezone),
  );
  const due = task.due
    ? combineTaskDateTime(
        addDays(value.date, dueOffsetDays(task)),
        taskTimePart(task.due, task.timezone),
      )
    : undefined;
  return {
    ...task,
    completed: value.completed,
    scheduled,
    due,
  };
}

export function projectTodayTasks(
  tasks: TaskSummary[],
  start: string,
  today: string,
  perSectionLimit: number,
): TodayTaskProjection {
  const materialized = materializedOccurrenceKeys(tasks);
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
        if (materialized.has(occurrence.key)) continue;
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
    if (task.completed || task.skipped || task.archived) continue;
    const date = taskDatePart(task.scheduled ?? task.due, task.timezone);
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
  tasks: TaskSummary[],
  today: string,
  recurrenceEnd: string,
  limit: number,
  materialized = materializedOccurrenceKeys(tasks),
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
        if (materialized.has(occurrence.key)) continue;
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
    if (task.completed || task.skipped || task.archived) continue;
    const date = taskDatePart(task.scheduled ?? task.due, task.timezone);
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

/** Find the first upcoming entry when the caller only needs one suggestion. */
export function nextUpcomingTask(
  tasks: readonly TaskSummary[],
  today: string,
  recurrenceEnd: string,
  materialized: ReadonlySet<string>,
): TaskOccurrenceEntry | undefined {
  const tomorrow = shiftTaskDate(today, 1);
  let next: TaskOccurrenceEntry | undefined;
  let repeatThrough = recurrenceEnd;
  for (const task of tasks) {
    if (task.recurrence) {
      for (const date of recurringDatesBetween(task, tomorrow, repeatThrough)) {
        const occurrence = taskOccurrenceForDate(task, date);
        if (
          occurrence.completed ||
          occurrence.skipped ||
          materialized.has(occurrence.key)
        )
          continue;
        next = { key: occurrence.key, task, occurrence, date };
        break;
      }
    } else if (!task.completed && !task.skipped && !task.archived) {
      const date = taskDatePart(task.scheduled ?? task.due, task.timezone);
      if (date > today && (!next || date < next.date))
        next = { key: task.id, task, date };
    }
    // Same-day ties keep the first task in source order. The repeating-task
    // horizon still applies when the earliest dated task is beyond it.
    if (next?.date === tomorrow) break;
    if (next && next.date <= repeatThrough)
      repeatThrough = shiftTaskDate(next.date, -1);
  }
  return next;
}

export function findOccurrenceParent(
  tasks: readonly TaskSummary[],
  occurrence: Pick<TaskSummary, "recurrenceParent">,
): TaskSummary | undefined {
  return buildOccurrenceParentIndex(tasks).resolve(occurrence.recurrenceParent);
}

export function findMaterializedOccurrenceTask(
  tasks: readonly TaskSummary[],
  parent: TaskSummary,
  date: string,
): TaskSummary | undefined {
  const parents = buildOccurrenceParentIndex(tasks);
  const matches = tasks.filter(
    (candidate) =>
      candidate.occurrenceDate === date &&
      parents.resolve(candidate.recurrenceParent)?.id === parent.id,
  );
  if (matches.length > 1)
    throw new Error(
      `duplicate_occurrence_note: Multiple occurrence notes represent ${date}.`,
    );
  return matches[0];
}

export function materializedOccurrenceKeys(
  tasks: readonly TaskSummary[],
): Set<string> {
  let parents: OccurrenceParentIndex | undefined;
  const keys = new Set<string>();
  for (const task of tasks) {
    if (!task.recurrenceParent || !task.occurrenceDate) continue;
    parents ??= buildOccurrenceParentIndex(tasks);
    const parent = parents.resolve(task.recurrenceParent);
    if (parent) keys.add(`${parent.id}:${task.occurrenceDate}`);
  }
  return keys;
}

interface OccurrenceParentIndex {
  resolve(reference: string | undefined): TaskSummary | undefined;
}

function buildOccurrenceParentIndex(
  tasks: readonly TaskSummary[],
): OccurrenceParentIndex {
  const exact = new Map<string, TaskSummary | null>();
  const filenames = new Map<string, TaskSummary | null>();
  for (const task of tasks) {
    addUniqueTask(exact, task.id.toLocaleLowerCase(), task);
    const path = normalizeTaskReference(task.path);
    addUniqueTask(exact, path, task);
    addUniqueTask(filenames, path.split("/").at(-1) ?? path, task);
  }
  return {
    resolve(value) {
      const reference = normalizeTaskReference(value);
      if (!reference) return undefined;
      const exactMatch = exact.get(reference);
      if (exactMatch !== undefined) return exactMatch ?? undefined;
      if (reference.includes("/")) return undefined;
      return filenames.get(reference) ?? undefined;
    },
  };
}

function addUniqueTask(
  index: Map<string, TaskSummary | null>,
  key: string,
  task: TaskSummary,
): void {
  const current = index.get(key);
  if (current === undefined) index.set(key, task);
  else if (current?.id !== task.id) index.set(key, null);
}

export async function occurrenceRecordId(
  parentId: string,
  occurrenceDate: string,
): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        `tasknotes-occurrence\0${parentId}\0${occurrenceDate}`,
      ),
    ),
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function rollingOccurrenceDates(
  task: TaskSummary,
  now = new Date(),
): string[] {
  if (!task.recurrence || task.occurrenceMaterialization !== "rolling")
    return [];
  const today = todayString(now, task.timezone);
  const start = shiftByIsoDuration(
    today,
    task.occurrencePastHorizon ?? "P0D",
    -1,
  );
  const end = shiftByIsoDuration(
    today,
    task.occurrenceFutureHorizon ?? "P14D",
    1,
  );
  return taskOccurrencesBetween(task, start, end).map(({ date }) => date);
}

function shiftByIsoDuration(
  value: string,
  duration: string,
  direction: -1 | 1,
): string {
  const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/.exec(
    duration,
  );
  if (!match || !match.slice(1).some(Boolean))
    throw new Error(
      `invalid_occurrence_horizon: ${duration} is not a finite date duration.`,
    );
  const date = dateFromStorage(value);
  if (!date) throw new Error(`invalid_date_value: ${value} is not a date.`);
  const calendarMonths = Number(match[1] ?? 0) * 12 + Number(match[2] ?? 0);
  if (calendarMonths) {
    const targetMonth = date.getMonth() + direction * calendarMonths;
    const targetDay = date.getDate();
    date.setDate(1);
    date.setMonth(targetMonth);
    const lastDay = new Date(
      date.getFullYear(),
      date.getMonth() + 1,
      0,
    ).getDate();
    date.setDate(Math.min(targetDay, lastDay));
  }
  date.setDate(
    date.getDate() +
      direction * (Number(match[3] ?? 0) * 7 + Number(match[4] ?? 0)),
  );
  return todayString(date);
}

function dueOffsetDays(task: TaskSummary): number {
  const scheduled = dateFromStorage(
    taskDatePart(
      task.scheduled ??
        recurrenceStartStorageValue(
          parseRecurrenceRule(task.recurrence).dtstart,
        ) ??
        task.createdAt,
      task.timezone,
    ),
  );
  const due = dateFromStorage(taskDatePart(task.due, task.timezone));
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

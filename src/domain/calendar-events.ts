import {
  calendarDateToInstant,
  calendarInstantToDate,
  createCalendarEntryIndex,
  type CalendarContext,
  type CalendarEntry as ModelCalendarEntry,
  type CalendarRange,
  type CalendarSettings,
  type CalendarTask,
} from "@tasknotes/model/calendar";
import type { CalendarItem } from "@tasknotes/calendar";

import { runtimeTimezone } from "./runtime-timezone";
import { materializedOccurrenceKeys } from "./task-occurrence";
import { TaskNotesTaskModel } from "./tasknotes-model";
import { defaultTaskCollectionConfiguration } from "./task-configuration";
import type { TaskCollectionConfiguration } from "./task-configuration";
import type { TaskSummary, TaskTimeEntry } from "./task";
import type { TaskOccurrence } from "./task-occurrence";
import type { TaskViewExecution, TaskViewRow } from "./view";

export interface CalendarEntry {
  modelEntry: ModelCalendarEntry;
  task: TaskSummary;
  row: TaskViewRow;
  occurrence?: TaskOccurrence;
  timeEntry?: TaskTimeEntry;
}

/** The renderer mapping is deliberately mechanical; model permissions win. */
export function calendarItem(
  entry: ModelCalendarEntry,
): CalendarItem<{ entry: ModelCalendarEntry }> {
  return {
    id: entry.id,
    title: entry.title,
    start: entry.start,
    end: entry.end ?? null,
    allDay: entry.allDay,
    kind: entry.type,
    editable: entry.startEditable,
    startEditable: entry.startEditable,
    durationEditable: entry.durationEditable,
    completed: entry.isCompleted,
    lane: entry.type === "timeEntry" ? "actual" : undefined,
    data: { entry },
  };
}

export function calendarSettings(
  execution: TaskViewExecution,
  configuration: TaskCollectionConfiguration,
  display: CalendarSettings = {},
): CalendarSettings {
  // Only known boolean options cross this boundary. Explicit false survives.
  const options = execution.view.presentation?.options ?? {};
  const settings: CalendarSettings = {};
  for (const key of [
    "showScheduled",
    "showDue",
    "showScheduledToDueSpan",
    "showRecurring",
    "showCompletedRecurringInstances",
    "showSkippedRecurringInstances",
    "showTimeEntries",
    "showOverdueOnToday",
    "showAllDaySlot",
    "hideCompletedFromOverdue",
  ] as const) {
    if (typeof options[key] === "boolean") settings[key] = options[key];
  }
  return {
    ...display,
    ...settings,
    calendarView:
      display.calendarView ??
      (typeof options.calendarView === "string"
        ? options.calendarView
        : undefined),
    completedStatuses: configuration.statuses
      .filter((status) => status.isCompleted)
      .map((status) => status.value),
  };
}

/** One instance per view. No IO; unchanged tasks retain their range expansions. */
export class AppCalendarEntryIndex {
  private readonly model: TaskNotesTaskModel;
  private readonly index;
  private readonly tasks = new Map<
    string,
    { task: TaskSummary; revision: number; info: CalendarTask }
  >();
  private order: string[] = [];

  constructor(
    configuration = defaultTaskCollectionConfiguration(),
    context = calendarContext(),
  ) {
    this.model = new TaskNotesTaskModel(configuration);
    this.index = createCalendarEntryIndex(context);
  }

  entries(
    execution: TaskViewExecution,
    range: CalendarRange,
    identityTasks: readonly TaskSummary[],
    context: CalendarContext,
  ): Map<string, CalendarEntry[]> {
    const materializedOccurrences: Record<string, string[]> = {};
    for (const key of materializedOccurrenceKeys(identityTasks)) {
      const separator = key.lastIndexOf(":");
      const id = key.slice(0, separator);
      (materializedOccurrences[id] ??= []).push(key.slice(separator + 1));
    }
    this.index.setContext({
      ...context,
      materializedOccurrences: {
        ...materializedOccurrences,
        ...context.materializedOccurrences,
      },
    });
    const ids = execution.rows.map(({ task }) => task.id || task.path);
    const membershipChanged =
      JSON.stringify(ids) !== JSON.stringify(this.order);
    const rows = new Map(
      execution.rows.map((row) => [row.task.id || row.task.path, row]),
    );
    for (const id of this.tasks.keys()) {
      if (!rows.has(id)) {
        this.tasks.delete(id);
        this.index.remove(id);
      }
    }
    for (const { task } of execution.rows) {
      const id = task.id || task.path;
      const previous = this.tasks.get(id);
      if (previous?.task === task && previous.revision === task.revision)
        continue;
      // Authorities can return new summary objects for unchanged records.
      const info =
        previous?.revision === task.revision &&
        JSON.stringify(previous.task.frontmatter) ===
          JSON.stringify(task.frontmatter)
          ? previous.info
          : this.model.calendarTaskInfo(task);
      this.tasks.set(id, { task, revision: task.revision, info });
      this.index.upsert(id, info, task.revision);
    }
    if (membershipChanged) {
      this.index.setTasks(ids.map((id) => this.tasks.get(id)!.info));
      for (const id of ids) {
        const cached = this.tasks.get(id)!;
        this.index.upsert(id, cached.info, cached.revision);
      }
      this.order = ids;
    }
    return groupCalendarEntries(
      this.index.entriesInRange(range),
      rows,
      context.timezone,
      range,
    );
  }

  clear() {
    this.index.clear();
    this.tasks.clear();
    this.order = [];
  }
}

export function calendarContext(): CalendarContext {
  return {
    timezone: runtimeTimezone(),
    now: new Date().toISOString(),
  };
}

/** Also used by the small calendar; bounds are exclusive, just like the renderer. */
export function calendarEvents(
  execution: TaskViewExecution,
  rangeStart: Date,
  rangeEnd: Date,
  identityTasks: readonly TaskSummary[],
  display: CalendarSettings = {},
  configuration = defaultTaskCollectionConfiguration(),
): Map<string, CalendarEntry[]> {
  const context = calendarContext();
  return new AppCalendarEntryIndex(configuration, context).entries(
    execution,
    { start: rangeStart.toISOString(), end: rangeEnd.toISOString() },
    identityTasks,
    {
      ...context,
      settings: calendarSettings(execution, configuration, display),
    },
  );
}

export function calendarEntryKey(entry: CalendarEntry): string {
  return entry.modelEntry.id;
}

function groupCalendarEntries(
  entries: ModelCalendarEntry[],
  rows: Map<string, TaskViewRow>,
  timezone: string,
  range: CalendarRange,
): Map<string, CalendarEntry[]> {
  const result = new Map<string, CalendarEntry[]>();
  for (const modelEntry of entries) {
    const row = rows.get(modelEntry.taskId);
    if (!row) continue;
    const entry: CalendarEntry = {
      modelEntry,
      task: row.task,
      row,
      ...(modelEntry.instanceDate
        ? {
            occurrence: {
              task: row.task,
              key: `${row.task.id}:${modelEntry.instanceDate}`,
              date: modelEntry.instanceDate,
              completed: modelEntry.isCompleted,
              skipped: modelEntry.isSkipped,
            },
          }
        : {}),
      ...(modelEntry.timeEntryIndex !== undefined
        ? { timeEntry: row.task.timeEntries[modelEntry.timeEntryIndex] }
        : {}),
    };
    const entryStart = calendarDateToInstant(modelEntry.start, timezone);
    const start = Math.max(
      entryStart,
      calendarDateToInstant(range.start, timezone),
    );
    const implicitEnd = modelEntry.allDay
      ? calendarDateToInstant(
          shiftCalendarDay(
            modelEntry.start.slice(0, 10),
            modelEntry.durationMinutes / 1440,
          ),
          timezone,
        )
      : entryStart + modelEntry.durationMinutes * 60_000;
    const end = Math.min(
      modelEntry.end
        ? calendarDateToInstant(modelEntry.end, timezone)
        : implicitEnd,
      calendarDateToInstant(range.end, timezone),
    );
    const first = calendarInstantToDate(start, timezone, true);
    const last = calendarInstantToDate(
      Math.max(start, end - 1),
      timezone,
      true,
    );
    // Group across every touched civil day without projecting/deduplicating tasks again.
    for (let day = first; day <= last;) {
      const values = result.get(day) ?? [];
      values.push(entry);
      result.set(day, values);
      day = shiftCalendarDay(day, 1);
    }
  }
  return result;
}

function shiftCalendarDay(day: string, days: number): string {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

import { serializeMarkdownDocument } from "@tasknotes/model/frontmatter";
import { stringify } from "yaml";

import type { TaskCollectionConfiguration } from "./task-configuration";
import type { TaskViewDocument } from "./view";
import type { TaskRepository } from "../storage/repository";

export const TASKNOTES_DEFAULT_VIEW_SOURCE_NAME = "tasknotes-app";
export const TASKNOTES_DEFAULT_VIEW_NAMES = [
  "Today",
  "Upcoming",
  "Calendar",
] as const;

export function taskNotesDefaultBaseDocument(
  configuration: TaskCollectionConfiguration,
): string {
  const fields = configuration.fieldMapping;
  const status = note(fields.status);
  const scheduled = note(fields.scheduled);
  const due = note(fields.due);
  const priority = note(fields.priority);
  const title = note(fields.title);
  const taskDate = `if(${scheduled}.isEmpty() == false, ${scheduled}, ${due})`;
  const taskDay =
    'if(formula.taskDate.isEmpty(), null, date(formula.taskDate).format("YYYY-MM-DD"))';
  const today = 'today().format("YYYY-MM-DD")';

  return stringify(
    {
      formulas: {
        taskDate,
        taskDay,
      },
      properties: {
        "formula.taskDate": {
          displayName: "Task date",
          hidden: true,
        },
        "formula.taskDay": {
          displayName: "Task day",
          hidden: true,
        },
      },
      filters: {
        and: activeTaskFilters(configuration),
      },
      views: [
        {
          type: "tasknotesTaskList",
          name: "Today",
          filters: {
            or: ["formula.taskDay.isEmpty()", `formula.taskDay <= ${today}`],
          },
          order: [title, status, scheduled, due, priority],
          sort: [
            { property: "formula.taskDay", direction: "ASC" },
            { property: priority, direction: "ASC" },
            { property: title, direction: "ASC" },
          ],
        },
        {
          type: "tasknotesCalendar",
          name: "Upcoming",
          order: [status, scheduled, due, priority],
          options: {
            calendarView: "listWeek",
            listDayCount: 7,
            showScheduled: true,
            showDue: true,
            showRecurring: true,
            showCompletedRecurringInstances: false,
            showSkippedRecurringInstances: false,
          },
        },
        {
          type: "tasknotesCalendar",
          name: "Calendar",
          order: [status, scheduled, due, priority],
          options: {
            calendarView: "dayGridMonth",
            listDayCount: 7,
            customDayCount: 3,
            showScheduled: true,
            showDue: true,
            showRecurring: true,
            showCompletedRecurringInstances: false,
            showSkippedRecurringInstances: false,
          },
        },
      ],
    },
    { lineWidth: 0 },
  );
}

export function taskNotesDefaultCanonicalDocument(
  configuration: TaskCollectionConfiguration,
): string {
  const fields = configuration.fieldMapping;
  const taskDate = `if(${fields.scheduled}.isEmpty() == false, ${fields.scheduled}, ${fields.due})`;
  const taskDay =
    'if(projection.task_date.isEmpty(), null, date(projection.task_date).format("YYYY-MM-DD"))';
  const sharedWhere = activeTaskFilters(configuration).join(" && ");
  const selection = [
    fields.title,
    fields.status,
    fields.scheduled,
    fields.due,
    fields.priority,
  ];

  return serializeMarkdownDocument(
    {
      type: "view",
      id: TASKNOTES_DEFAULT_VIEW_SOURCE_NAME,
      version: 1,
      name: "TaskNotes",
      query: {
        types: ["task"],
        where: sharedWhere,
        projections: {
          task_date: taskDate,
          task_day: taskDay,
        },
      },
      views: [
        {
          id: "today",
          name: "Today",
          where:
            'projection.task_day.isEmpty() || projection.task_day <= today().format("YYYY-MM-DD")',
          select: selection,
          order_by: [
            { field: "projection.task_day", direction: "asc" },
            { field: fields.priority, direction: "asc" },
            { field: fields.title, direction: "asc" },
          ],
          presentation: {
            type: "tasknotes.task-list",
            fallback: "mdbase.table",
          },
        },
        calendarCanonicalView("upcoming", "Upcoming", selection, "listWeek"),
        calendarCanonicalView(
          "calendar",
          "Calendar",
          selection,
          "dayGridMonth",
        ),
      ],
    },
    "",
  );
}

export function isTaskNotesDefaultViewDocument(
  document: TaskViewDocument,
): boolean {
  const filename = document.source.path.split("/").at(-1)?.toLowerCase() ?? "";
  return (
    filename === `${TASKNOTES_DEFAULT_VIEW_SOURCE_NAME}.base` ||
    filename === `${TASKNOTES_DEFAULT_VIEW_SOURCE_NAME}.md` ||
    document.id === TASKNOTES_DEFAULT_VIEW_SOURCE_NAME
  );
}

export function defaultNavigationViewKeys(
  documents: readonly TaskViewDocument[],
): string[] {
  const source = documents.find(isTaskNotesDefaultViewDocument);
  if (!source) return [];
  return TASKNOTES_DEFAULT_VIEW_NAMES.flatMap((name) => {
    const view = source.views.find((candidate) => candidate.name === name);
    return view ? [view.key] : [];
  });
}

export async function ensureTaskNotesDefaultViewSource(
  repository: TaskRepository,
  documents: TaskViewDocument[],
  configuration: TaskCollectionConfiguration,
): Promise<TaskViewDocument[]> {
  if (documents.some(isTaskNotesDefaultViewDocument)) return documents;

  try {
    await repository.createViewSource({
      format: "obsidian.base",
      name: TASKNOTES_DEFAULT_VIEW_SOURCE_NAME,
      document: taskNotesDefaultBaseDocument(configuration),
    });
  } catch (baseError) {
    const concurrent = await repository.listViews();
    if (concurrent.some(isTaskNotesDefaultViewDocument)) return concurrent;
    if (concurrent.length) return concurrent;
    const sync = await repository.syncStatus();
    if (sync.mode !== "replicated") throw baseError;
    await repository.createViewSource({
      format: "mdbase.view",
      name: TASKNOTES_DEFAULT_VIEW_SOURCE_NAME,
      document: taskNotesDefaultCanonicalDocument(configuration),
    });
  }
  return repository.listViews();
}

function calendarCanonicalView(
  id: string,
  name: string,
  selection: string[],
  calendarView: "dayGridMonth" | "listWeek",
): Record<string, unknown> {
  return {
    id,
    name,
    select: selection,
    presentation: {
      type: "tasknotes.calendar",
      fallback: "mdbase.table",
      options: {
        calendarView,
        listDayCount: 7,
        customDayCount: 3,
        showScheduled: true,
        showDue: true,
        showRecurring: true,
        showCompletedRecurringInstances: false,
        showSkippedRecurringInstances: false,
      },
    },
  };
}

function activeTaskFilters(
  configuration: TaskCollectionConfiguration,
): string[] {
  const status = note(configuration.fieldMapping.status);
  const completed = configuration.statuses
    .filter((entry) => entry.isCompleted)
    .map((entry) => `${status} != ${literal(entry.value)}`);
  return [
    `${status}.isEmpty() == false`,
    ...completed,
    `file.hasTag(${literal(configuration.fieldMapping.archiveTag)}) != true`,
  ];
}

function note(field: string): string {
  return `note[${literal(field)}]`;
}

function literal(value: string): string {
  return JSON.stringify(value);
}

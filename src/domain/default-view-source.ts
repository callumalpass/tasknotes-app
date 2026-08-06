import { serializeMarkdownDocument } from "@tasknotes/model/frontmatter";
import { parse, stringify } from "yaml";

import type { TaskCollectionConfiguration } from "./task-configuration";
import type { TaskViewDocument } from "./view";

export const TASKNOTES_DEFAULT_VIEW_SOURCE_NAME = "tasknotes-app";
export const TASKNOTES_VIEW_SOURCE_FOLDER = "TaskNotes/Views";
export const TASKNOTES_DEFAULT_VIEW_NAMES = [
  "Today",
  "Upcoming",
  "Calendar",
  "Projects",
  "Archive",
] as const;
export const TASKNOTES_DEFAULT_VIEW_SOURCES = TASKNOTES_DEFAULT_VIEW_NAMES.map(
  (name) => ({
    name,
    path: taskNotesViewSourcePath(name),
  }),
);

export function taskNotesViewSourcePath(name: string): string {
  const slug = name
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${TASKNOTES_VIEW_SOURCE_FOLDER}/${slug || "view"}.base`;
}

export interface TaskNotesDefaultViewSource {
  name: (typeof TASKNOTES_DEFAULT_VIEW_NAMES)[number];
  path: string;
  document: string;
}

export function taskNotesDefaultBaseSources(
  configuration: TaskCollectionConfiguration,
): TaskNotesDefaultViewSource[] {
  const definition = parse(taskNotesDefaultBaseDocument(configuration)) as {
    formulas?: Record<string, unknown>;
    properties?: Record<string, unknown>;
    views: Array<{ name: string } & Record<string, unknown>>;
  };
  return TASKNOTES_DEFAULT_VIEW_SOURCES.map((source) => {
    const view = definition.views.find(({ name }) => name === source.name);
    if (!view)
      throw new Error(`TaskNotes has no '${source.name}' starter view.`);
    return {
      ...source,
      document: stringify(
        {
          ...(definition.formulas ? { formulas: definition.formulas } : {}),
          ...(definition.properties
            ? { properties: definition.properties }
            : {}),
          views: [view],
        },
        { lineWidth: 0 },
      ),
    };
  });
}

export function taskNotesDefaultBaseDocument(
  configuration: TaskCollectionConfiguration,
): string {
  const fields = configuration.fieldMapping;
  const status = note(fields.status);
  const scheduled = note(fields.scheduled);
  const due = note(fields.due);
  const priority = note(fields.priority);
  const projects = note(fields.projects);
  const title = note(fields.title);
  const manualOrder = basesProperty(fields.sortOrder);
  const taskDate = `if(${scheduled}.isEmpty() == false, ${scheduled}, ${due})`;
  const taskDay =
    "if(formula.taskDate.isEmpty(), null, date(formula.taskDate))";
  const today = "today()";

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
        [manualOrder]: {
          displayName: "Manual order",
          hidden: true,
        },
      },
      views: [
        {
          type: "tasknotesTaskList",
          name: "Today",
          filters: {
            and: [
              ...activeTaskFilters(configuration),
              {
                or: [
                  "formula.taskDay.isEmpty()",
                  `formula.taskDay <= ${today}`,
                ],
              },
            ],
          },
          order: [title, status, scheduled, due, priority],
          sort: [
            { property: manualOrder, direction: "DESC" },
            { property: "formula.taskDay", direction: "ASC" },
            { property: priority, direction: "ASC" },
            { property: title, direction: "ASC" },
          ],
          options: { sections: "day" },
        },
        {
          type: "tasknotesCalendar",
          name: "Upcoming",
          filters: { and: activeTaskFilters(configuration) },
          order: [status, scheduled, due, priority],
          sort: [{ property: manualOrder, direction: "DESC" }],
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
          filters: { and: activeTaskFilters(configuration) },
          order: [status, scheduled, due, priority],
          sort: [{ property: manualOrder, direction: "DESC" }],
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
        {
          type: "tasknotesTaskList",
          name: "Projects",
          filters: {
            and: [
              ...activeTaskFilters(configuration),
              `${projects}.isEmpty() == false`,
            ],
          },
          order: [title, status, scheduled, due, priority],
          sort: [
            { property: manualOrder, direction: "DESC" },
            { property: title, direction: "ASC" },
          ],
          groupBy: { property: projects, direction: "ASC" },
          options: { create: false },
        },
        {
          type: "tasknotesTaskList",
          name: "Archive",
          filters: { and: [archivedTaskFilter(configuration)] },
          order: [title, status, scheduled, due, priority],
          sort: [
            { property: manualOrder, direction: "DESC" },
            { property: title, direction: "ASC" },
          ],
          options: { create: false },
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
    "if(projection.task_date.isEmpty(), null, date(projection.task_date))";
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
        projections: {
          task_date: { expr: taskDate },
          task_day: { expr: taskDay },
        },
      },
      views: [
        {
          id: "today",
          name: "Today",
          where: `(${sharedWhere}) && (projection.task_day.isEmpty() || projection.task_day <= today())`,
          select: selection,
          order_by: [
            { field: fields.sortOrder, direction: "desc" },
            { field: "projection.task_day", direction: "asc" },
            { field: fields.priority, direction: "asc" },
            { field: fields.title, direction: "asc" },
          ],
          presentation: {
            type: "tasknotes.task-list",
            fallback: "mdbase.table",
            options: { sections: "day" },
          },
        },
        calendarCanonicalView(
          "upcoming",
          "Upcoming",
          selection,
          "listWeek",
          sharedWhere,
          fields.sortOrder,
        ),
        calendarCanonicalView(
          "calendar",
          "Calendar",
          selection,
          "dayGridMonth",
          sharedWhere,
          fields.sortOrder,
        ),
        {
          id: "projects",
          name: "Projects",
          where: `(${sharedWhere}) && (note[${literal(fields.projects)}].isEmpty() == false)`,
          select: selection,
          order_by: [
            { field: fields.sortOrder, direction: "desc" },
            { field: fields.title, direction: "asc" },
          ],
          group_by: [{ field: fields.projects, direction: "asc" }],
          presentation: {
            type: "tasknotes.task-list",
            fallback: "mdbase.table",
            options: { create: false },
          },
        },
        {
          id: "archive",
          name: "Archive",
          where: archivedTaskFilter(configuration),
          select: selection,
          order_by: [
            { field: fields.sortOrder, direction: "desc" },
            { field: fields.title, direction: "asc" },
          ],
          presentation: {
            type: "tasknotes.task-list",
            fallback: "mdbase.table",
            options: { create: false },
          },
        },
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
    TASKNOTES_DEFAULT_VIEW_SOURCES.some(
      ({ path }) => path.toLowerCase() === document.source.path.toLowerCase(),
    ) ||
    filename === `${TASKNOTES_DEFAULT_VIEW_SOURCE_NAME}.base` ||
    filename === `${TASKNOTES_DEFAULT_VIEW_SOURCE_NAME}.md` ||
    document.id === TASKNOTES_DEFAULT_VIEW_SOURCE_NAME
  );
}

export function defaultNavigationViewKeys(
  documents: readonly TaskViewDocument[],
): string[] {
  const defaults = documents.filter(isTaskNotesDefaultViewDocument);
  return TASKNOTES_DEFAULT_VIEW_SOURCES.flatMap(({ name, path }) => {
    const source =
      defaults.find(
        (document) => document.source.path.toLowerCase() === path.toLowerCase(),
      ) ??
      defaults.find((document) =>
        document.views.some((candidate) => candidate.name === name),
      );
    const view = source?.views.find((candidate) => candidate.name === name);
    return view ? [view.key] : [];
  });
}

function calendarCanonicalView(
  id: string,
  name: string,
  selection: string[],
  calendarView: "dayGridMonth" | "listWeek",
  where: string,
  sortOrderField: string,
): Record<string, unknown> {
  return {
    id,
    name,
    where,
    select: selection,
    order_by: [{ field: sortOrderField, direction: "desc" }],
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
  file = "file",
): string[] {
  const status =
    file === "file"
      ? note(configuration.fieldMapping.status)
      : `${file}.properties[${literal(configuration.fieldMapping.status)}]`;
  const completed = configuration.statuses
    .filter((entry) => entry.isCompleted)
    .map((entry) => `${status} != ${literal(entry.value)}`);
  return [
    `${status}.isEmpty() == false`,
    ...completed,
    `${file}.hasTag(${literal(configuration.fieldMapping.archiveTag)}) != true`,
  ];
}

function archivedTaskFilter(
  configuration: TaskCollectionConfiguration,
): string {
  return `file.hasTag(${literal(configuration.fieldMapping.archiveTag)}) == true`;
}

function note(field: string): string {
  return `note[${literal(field)}]`;
}

function basesProperty(field: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(field)
    ? `note.${field}`
    : note(field);
}

function literal(value: string): string {
  return JSON.stringify(value);
}

import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import { isSeq, parse, parseDocument, stringify } from "yaml";

import type { TaskCollectionConfiguration } from "./task-configuration";
import type { TaskViewDocument } from "./view";
import type { TaskRepository } from "../storage/repository";

export const TASKNOTES_DEFAULT_VIEW_SOURCE_NAME = "tasknotes-app";
const TASKNOTES_DEFAULT_VIEW_SOURCE_VERSION = 2;
export const TASKNOTES_DEFAULT_VIEW_NAMES = [
  "Today",
  "Upcoming",
  "Calendar",
  "Projects",
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
      "x-tasknotes-app": {
        version: TASKNOTES_DEFAULT_VIEW_SOURCE_VERSION,
      },
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
            { property: "formula.taskDay", direction: "ASC" },
            { property: priority, direction: "ASC" },
            { property: title, direction: "ASC" },
          ],
        },
        {
          type: "tasknotesCalendar",
          name: "Upcoming",
          filters: { and: activeTaskFilters(configuration) },
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
          filters: { and: activeTaskFilters(configuration) },
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
        {
          type: "tasknotesProjects",
          name: "Projects",
          filters: projectRelationshipFilter(configuration),
          order: ["file.name", "file.folder"],
          sort: [{ property: "file.name", direction: "ASC" }],
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
      "x-tasknotes-app": {
        version: TASKNOTES_DEFAULT_VIEW_SOURCE_VERSION,
      },
      query: {
        projections: {
          task_date: taskDate,
          task_day: taskDay,
        },
      },
      views: [
        {
          id: "today",
          name: "Today",
          where: `(${sharedWhere}) && (projection.task_day.isEmpty() || projection.task_day <= today().format("YYYY-MM-DD"))`,
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
        calendarCanonicalView(
          "upcoming",
          "Upcoming",
          selection,
          "listWeek",
          sharedWhere,
        ),
        calendarCanonicalView(
          "calendar",
          "Calendar",
          selection,
          "dayGridMonth",
          sharedWhere,
        ),
        {
          id: "projects",
          name: "Projects",
          where: projectRelationshipExpression(configuration),
          select: ["file.name", "file.folder"],
          order_by: [{ field: "file.name", direction: "asc" }],
          presentation: {
            type: "tasknotes.projects",
            fallback: "mdbase.table",
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
  const existing = documents.find(isTaskNotesDefaultViewDocument);
  if (existing) {
    if (existing.views.some(({ name }) => name === "Projects"))
      return documents;
    return upgradeTaskNotesDefaultViewSource(
      repository,
      documents,
      existing,
      configuration,
    );
  }

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

async function upgradeTaskNotesDefaultViewSource(
  repository: TaskRepository,
  documents: TaskViewDocument[],
  existing: TaskViewDocument,
  configuration: TaskCollectionConfiguration,
): Promise<TaskViewDocument[]> {
  if (!existing.source.writable) return documents;
  try {
    const source = await repository.readViewSource(existing.source.path);
    if (source.format === "obsidian.base") {
      const document = parseDocument(source.document);
      const value = document.toJS() as Record<string, unknown> | null;
      const metadata =
        value?.["x-tasknotes-app"] &&
        typeof value["x-tasknotes-app"] === "object"
          ? (value["x-tasknotes-app"] as Record<string, unknown>)
          : {};
      if (
        typeof metadata.version === "number" &&
        metadata.version >= TASKNOTES_DEFAULT_VIEW_SOURCE_VERSION
      )
        return documents;
      const views = document.get("views", true);
      if (!isSeq(views)) return documents;
      const generated = parse(
        taskNotesDefaultBaseDocument(configuration),
      ) as Record<string, unknown>;
      const project = (generated.views as Array<Record<string, unknown>>).find(
        (view) => view.name === "Projects",
      );
      if (project) views.add(project);
      document.set("x-tasknotes-app", {
        version: TASKNOTES_DEFAULT_VIEW_SOURCE_VERSION,
      });
      await repository.updateViewSource({
        path: source.path,
        document: String(document),
        ifRevision: source.revision,
      });
      return repository.listViews();
    }
    if (source.format === "mdbase.view") {
      const parsed = parseFrontmatter(source.document);
      const metadata =
        parsed.frontmatter["x-tasknotes-app"] &&
        typeof parsed.frontmatter["x-tasknotes-app"] === "object"
          ? (parsed.frontmatter["x-tasknotes-app"] as Record<string, unknown>)
          : {};
      if (
        typeof metadata.version === "number" &&
        metadata.version >= TASKNOTES_DEFAULT_VIEW_SOURCE_VERSION
      )
        return documents;
      const generated = parseFrontmatter(
        taskNotesDefaultCanonicalDocument(configuration),
      ).frontmatter;
      const currentViews = Array.isArray(parsed.frontmatter.views)
        ? parsed.frontmatter.views
        : [];
      const project = Array.isArray(generated.views)
        ? generated.views.find(
            (view) =>
              view &&
              typeof view === "object" &&
              (view as Record<string, unknown>).id === "projects",
          )
        : undefined;
      if (project) currentViews.push(project);
      parsed.frontmatter.views = currentViews;
      parsed.frontmatter["x-tasknotes-app"] = {
        version: TASKNOTES_DEFAULT_VIEW_SOURCE_VERSION,
      };
      await repository.updateViewSource({
        path: source.path,
        document: serializeMarkdownDocument(parsed.frontmatter, parsed.body),
        ifRevision: source.revision,
      });
      return repository.listViews();
    }
  } catch {
    const concurrent = await repository.listViews().catch(() => documents);
    if (
      concurrent
        .find(isTaskNotesDefaultViewDocument)
        ?.views.some(({ name }) => name === "Projects")
    )
      return concurrent;
  }
  return documents;
}

function calendarCanonicalView(
  id: string,
  name: string,
  selection: string[],
  calendarView: "dayGridMonth" | "listWeek",
  where: string,
): Record<string, unknown> {
  return {
    id,
    name,
    where,
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

function projectRelationshipFilter(
  configuration: TaskCollectionConfiguration,
): { and: string[] } {
  return { and: [projectRelationshipExpression(configuration)] };
}

function projectRelationshipExpression(
  configuration: TaskCollectionConfiguration,
): string {
  const backlink = "value.asFile()";
  const projectValues = `${backlink}.properties[${literal(
    configuration.fieldMapping.projects,
  )}]`;
  const normalizedProject =
    'file(value.replace(/^\\[[^\\]]+\\]\\((.*)\\)$/, "$1").replace("[[", "").replace("]]", "").split("|")[0].split("#")[0].replace(/%20/g, " ")).asLink()';
  const relationship = `list(${projectValues}).map(${normalizedProject}).contains(file.asLink())`;
  const active = activeTaskFilters(configuration, backlink);
  return `file.backlinks.filter(${[...active, relationship]
    .map((expression) => `(${expression})`)
    .join(" && ")}).length > 0`;
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

function note(field: string): string {
  return `note[${literal(field)}]`;
}

function literal(value: string): string {
  return JSON.stringify(value);
}

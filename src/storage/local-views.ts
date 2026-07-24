import {
  compileExpression,
  compileFilter,
  compileFormulaSet,
  createEvaluationContext,
} from "obsidian-bases-expression";
import { parse } from "yaml";

import { taskViewKey } from "../domain/view";
import { linkTarget } from "../domain/completion";

import type { Task } from "../domain/task";
import type { CollectionRecord } from "../domain/completion";
import type {
  TaskView,
  TaskViewDocument,
  TaskViewExecution,
  TaskViewGroup,
  TaskViewPresentation,
} from "../domain/view";
import { normalizePresentationType } from "../domain/view-renderer";
import type { MarkdownCollection } from "./collection";
import type { VaultEntry } from "./vault";

interface BaseDocument {
  filters?: BaseFilter;
  formulas?: Record<string, string>;
  properties?: Record<string, BasePropertyMetadata>;
  views?: BaseView[];
}

interface BasePropertyMetadata {
  displayName?: string;
  label?: string;
  description?: string;
  format?: string;
  hidden?: boolean;
}

type BaseFilter =
  | string
  | {
      and?: BaseFilter | BaseFilter[];
      or?: BaseFilter | BaseFilter[];
      not?: BaseFilter | BaseFilter[];
    };

interface BaseView {
  type: string;
  name: string;
  filters?: BaseFilter;
  order?: string[];
  sort?: Array<{ property: string; direction?: string }>;
  groupBy?: string | { property: string; direction?: string };
  limit?: number;
  options?: Record<string, unknown>;
}

interface LoadedSource {
  entry: VaultEntry;
  document: BaseDocument;
  source: string;
  ids: string[];
}

interface LocalViewTask extends Task {
  sourceMtime?: number;
  sourceSize?: number;
}

export class LocalViewExecutor {
  constructor(
    private readonly collection: MarkdownCollection,
    private readonly tasks: () => LocalViewTask[],
  ) {}

  async list(): Promise<TaskViewDocument[]> {
    const result: TaskViewDocument[] = [];
    for (const source of await this.sources()) {
      const documentName = fileStem(source.entry.path);
      const documentId = identifier(documentName, "base");
      const viewSource = {
        path: source.entry.path,
        format: "obsidian.base",
        revision: await viewSourceRevision(source.source),
        writable: true,
      };
      result.push({
        id: documentId,
        name: documentName,
        source: viewSource,
        views: (source.document.views ?? []).map((view, index) => {
          const id = source.ids[index];
          return {
            key: taskViewKey(source.entry.path, id),
            documentId,
            documentName,
            id,
            name: view.name,
            properties: (view.order ?? []).map((key) =>
              propertyDescriptor(key, source.document.properties),
            ),
            source: viewSource,
            presentation: presentation(view),
          };
        }),
      });
    }
    return result;
  }

  async execute(selected: TaskView): Promise<TaskViewExecution> {
    const source = (await this.sources()).find(
      (candidate) => candidate.entry.path === selected.source.path,
    );
    if (!source)
      throw new Error("The saved view source is no longer available.");
    const index = source.ids.indexOf(selected.id);
    const view = source.document.views?.[index];
    if (!view) throw new Error("The saved view is no longer available.");

    const formulas = compileFormulaSet(source.document.formulas ?? {});
    const sharedFilter = compileFilter(source.document.filters);
    const localFilter = compileFilter(view.filters);
    const invalid = [
      ...formulas.diagnostics,
      ...sharedFilter.diagnostics,
      ...localFilter.diagnostics,
    ].find((diagnostic) => diagnostic.severity === "error");
    if (invalid)
      throw new Error(`The saved view is invalid. ${invalid.message}`);

    const tasks = this.tasks();
    const tasksByPath = new Map(tasks.map((task) => [task.path, task]));
    const records = await this.collection.listCollectionRecords();
    const recordPaths = new Set(records.map((record) => record.path));
    for (const task of tasks) {
      if (recordPaths.has(task.path)) continue;
      records.push({
        path: task.path,
        label: task.title,
        frontmatter: task.frontmatter,
        body: task.body,
        types: ["task"],
      });
    }
    const configuration = await this.collection.taskConfiguration();
    const files = recordFiles(
      records,
      configuration.fieldMapping.projects,
      tasksByPath,
    );
    const rows = records.flatMap((record) => {
      const task = tasksByPath.get(record.path);
      const file = files.find((candidate) => candidate.path === record.path)!;
      const context = createEvaluationContext({
        note: record.frontmatter,
        file,
        files,
        formulas: source.document.formulas ?? {},
      });
      if (
        !sharedFilter.evaluateToBoolean(context) ||
        !localFilter.evaluateToBoolean(context)
      ) {
        return [];
      }
      const formulaValues = formulas.evaluateToPlain(context);
      const computedValues: Record<string, unknown> = {};
      for (const property of selectedProperties(view)) {
        computedValues[property] = property.startsWith("formula.")
          ? (formulaValues[property.slice("formula.".length)] ?? null)
          : evaluateProperty(property, context, record);
      }
      const values = Object.fromEntries(
        (view.order ?? []).map((property) => [
          property,
          computedValues[property] ?? null,
        ]),
      );
      const groupedProperty = groupProperty(view.groupBy);
      if (groupedProperty && !(groupedProperty in values))
        values[groupedProperty] = computedValues[groupedProperty] ?? null;
      return [{ task, record, values, computedValues }];
    });

    rows.sort((left, right) => {
      for (const sort of view.sort ?? []) {
        const compared = compareValues(
          left.computedValues[sort.property],
          right.computedValues[sort.property],
        );
        if (compared)
          return sort.direction?.toUpperCase() === "DESC"
            ? -compared
            : compared;
      }
      return left.record.path.localeCompare(right.record.path);
    });
    const totalCount = rows.length;
    const limited =
      typeof view.limit === "number" ? rows.slice(0, view.limit) : rows;
    return {
      view: selected,
      rows: limited.flatMap(({ task, values }) =>
        task ? [{ task, values }] : [],
      ),
      records: limited.map(({ record, values }) => ({ record, values })),
      totalCount,
      hasMore: limited.length < totalCount,
      groups: groups(
        rows.flatMap(({ task, computedValues }) =>
          task ? [{ task, values: computedValues }] : [],
        ),
        groupProperty(view.groupBy),
      ),
    };
  }

  private async sources(): Promise<LoadedSource[]> {
    const loaded: LoadedSource[] = [];
    for (const entry of await this.collection.listViewSources()) {
      try {
        const source = await this.collection.readText(entry.path);
        const document = parse(source) as BaseDocument;
        if (!document || !Array.isArray(document.views)) continue;
        loaded.push({
          entry,
          source,
          document,
          ids: stableViewIds(document.views),
        });
      } catch {
        // An invalid source remains untouched and does not hide valid views.
      }
    }
    return loaded;
  }
}

function propertyDescriptor(
  key: string,
  properties: BaseDocument["properties"],
): TaskView["properties"][number] {
  const metadata = properties?.[key] ?? properties?.[`note.${key}`];
  return {
    key,
    ...(metadata?.displayName || metadata?.label
      ? { label: metadata.displayName ?? metadata.label }
      : {}),
    ...(metadata?.description ? { description: metadata.description } : {}),
    ...(metadata?.format ? { format: metadata.format } : {}),
    ...(typeof metadata?.hidden === "boolean"
      ? { hidden: metadata.hidden }
      : {}),
  };
}

function presentation(view: BaseView): TaskViewPresentation {
  const type = normalizePresentationType(view.type);
  const column = groupProperty(view.groupBy);
  return {
    type,
    fallback: "mdbase.table",
    mappings: column && type === "tasknotes.kanban" ? { column } : {},
    options: structuredClone(view.options ?? {}),
  };
}

function selectedProperties(view: BaseView): string[] {
  const properties = new Set(view.order ?? []);
  for (const sort of view.sort ?? []) properties.add(sort.property);
  const group = groupProperty(view.groupBy);
  if (group) properties.add(group);
  return [...properties];
}

function evaluateProperty(
  property: string,
  context: ReturnType<typeof createEvaluationContext>,
  record: CollectionRecord,
): unknown {
  if (
    property.startsWith("file.") ||
    property.startsWith("note.") ||
    property.startsWith("note[")
  )
    return compileExpression(property).evaluateToPlain(context);
  return record.frontmatter[property] ?? null;
}

function recordFiles(
  records: CollectionRecord[],
  projectsField: string,
  tasksByPath: Map<string, LocalViewTask>,
) {
  const files = records.map((record) =>
    recordFile(record, tasksByPath.get(record.path)),
  );
  const byPath = new Map(files.map((file) => [file.path, file]));
  const backlinks = new Map<string, Set<string>>();
  for (const record of records) {
    const targets = extractRecordLinks(record, projectsField);
    const file = byPath.get(record.path);
    if (!file) continue;
    file.links = targets.map((target) => {
      const resolvedPath = resolveLocalLink(target, record.path, files);
      if (resolvedPath) {
        const sources = backlinks.get(resolvedPath) ?? new Set<string>();
        sources.add(record.path);
        backlinks.set(resolvedPath, sources);
      }
      return { path: linkTarget(target), resolvedPath };
    });
  }
  for (const file of files)
    file.backlinks = [...(backlinks.get(file.path) ?? [])].map((path) => ({
      path,
      resolvedPath: path,
    }));
  return files;
}

function recordFile(record: CollectionRecord, task?: LocalViewTask) {
  const name = record.path.split("/").at(-1) ?? record.path;
  const basename = name.endsWith(".md") ? name.slice(0, -3) : name;
  return {
    path: record.path,
    name,
    basename,
    folder: record.path.includes("/")
      ? record.path.slice(0, record.path.lastIndexOf("/"))
      : "",
    ext: "md",
    size: task?.sourceSize ?? 0,
    ctime: validDate(task?.createdAt),
    mtime:
      task?.sourceMtime === undefined
        ? validDate(task?.updatedAt)
        : new Date(task.sourceMtime),
    properties: record.frontmatter,
    tags: [
      ...new Set([
        ...frontmatterTags(record.frontmatter.tags),
        ...bodyTags(record.body ?? ""),
      ]),
    ],
    links: [] as Array<{ path: string; resolvedPath?: string }>,
    backlinks: [] as Array<{ path: string; resolvedPath?: string }>,
  };
}

function frontmatterTags(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,]+/)
      : [];
  return values
    .flatMap((entry) =>
      typeof entry === "string" ? [entry.replace(/^#/, "").trim()] : [],
    )
    .filter(Boolean);
}

function validDate(value?: string): Date {
  const date = new Date(value ?? 0);
  return Number.isNaN(date.valueOf()) ? new Date(0) : date;
}

function extractRecordLinks(
  record: CollectionRecord,
  projectsField: string,
): string[] {
  const links = new Set<string>();
  const visit = (value: unknown, includePlain = false) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/\[\[[^\]]+\]\]|\[[^\]]*\]\([^)]+\)/g))
        links.add(match[0]);
      if (includePlain && value.trim() && !/^https?:\/\//i.test(value.trim()))
        links.add(value.trim());
      return;
    }
    if (Array.isArray(value))
      for (const item of value) visit(item, includePlain);
  };
  for (const [key, value] of Object.entries(record.frontmatter))
    visit(value, key === projectsField);
  for (const match of (record.body ?? "").matchAll(
    /!?\[\[[^\]]+\]\]|!?\[[^\]]*\]\([^)]+\)/g,
  ))
    links.add(match[0].replace(/^!/, ""));
  return [...links];
}

function resolveLocalLink(
  value: string,
  sourcePath: string,
  files: Array<{ path: string; basename: string }>,
): string | undefined {
  const target = linkTarget(value);
  if (!target) return undefined;
  const lower = target.toLocaleLowerCase();
  const exact = files.find(
    ({ path }) =>
      path.replace(/\.md$/i, "").toLocaleLowerCase() === lower ||
      path.toLocaleLowerCase() === lower,
  );
  if (exact) return exact.path;
  if (target.startsWith("./") || target.startsWith("../")) {
    const folder = sourcePath.includes("/")
      ? sourcePath.slice(0, sourcePath.lastIndexOf("/"))
      : "";
    const resolved = normalizeRelativePath(`${folder}/${target}`);
    return files.find(
      ({ path }) =>
        path.replace(/\.md$/i, "").toLocaleLowerCase() ===
        resolved.toLocaleLowerCase(),
    )?.path;
  }
  if (target.includes("/")) return undefined;
  return files
    .filter(({ basename }) => basename.toLocaleLowerCase() === lower)
    .sort((left, right) => left.path.localeCompare(right.path))[0]?.path;
}

function normalizeRelativePath(value: string): string {
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

function bodyTags(body: string): string[] {
  const source = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  return [...source.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map(
    (match) => match[1],
  );
}

function groups(
  rows: TaskViewExecution["rows"],
  property: string | undefined,
): TaskViewGroup[] {
  if (!property) return [];
  const buckets = new Map<string, TaskViewGroup>();
  for (const row of rows) {
    const value = row.values[property] ?? null;
    const key = JSON.stringify(value);
    const bucket = buckets.get(key) ?? {
      values: { [property]: value },
      count: 0,
      summaries: {},
    };
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((left, right) =>
    compareValues(left.values[property], right.values[property]),
  );
}

function groupProperty(group: BaseView["groupBy"]): string | undefined {
  return typeof group === "string" ? group : group?.property;
}

function compareValues(left: unknown, right: unknown): number {
  if (Object.is(left, right)) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  if (typeof left === "number" && typeof right === "number")
    return left - right;
  return String(left).localeCompare(String(right));
}

function stableViewIds(views: BaseView[]): string[] {
  const counts = new Map<string, number>();
  return views.map((view) => {
    const base = identifier(view.name, "view");
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  });
}

function identifier(value: string, fallback: string): string {
  const normalized = value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_.:]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(normalized) ? normalized : `${fallback}-${normalized}`;
}

function fileStem(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  return name.endsWith(".base") ? name.slice(0, -5) : name;
}

export async function viewSourceRevision(source: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

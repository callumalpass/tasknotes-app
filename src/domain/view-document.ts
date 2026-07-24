import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import { isMap, isSeq, parseDocument, stringify } from "yaml";

import type { YAMLMap } from "yaml";

import type { TaskViewSourceDocument } from "./view";
import {
  editableRenderer,
  isCalendarRenderer,
  obsidianRenderer,
  type ViewRenderer,
} from "./view-renderer";

export type ViewDialect = "obsidian-bases" | "mdbase-cel";
export type { ViewRenderer } from "./view-renderer";

export interface EditableViewDraft {
  id: string;
  name: string;
  renderer: ViewRenderer;
  filter?: unknown;
  properties: string[];
  sort: EditableViewSort[];
  groupProperty?: string;
  groupDirection: "asc" | "desc";
  options: Record<string, unknown>;
  dialect: ViewDialect;
  availableProperties: string[];
}

export interface EditableViewSort {
  property: string;
  direction: "asc" | "desc";
}

export function readViewDraft(
  source: TaskViewSourceDocument,
  viewId: string,
): EditableViewDraft {
  return source.format === "obsidian.base"
    ? readObsidianDraft(source.document, viewId)
    : readCanonicalDraft(source.document, viewId);
}

export function updateViewDocument(
  source: TaskViewSourceDocument,
  draft: EditableViewDraft,
): string {
  return source.format === "obsidian.base"
    ? updateObsidianDocument(source.document, draft)
    : updateCanonicalDocument(source.document, draft);
}

export function createViewDocument(
  format: "obsidian.base" | "mdbase.view",
  draft: EditableViewDraft,
): string {
  if (format === "obsidian.base") {
    return stringify({ views: [obsidianView(draft)] });
  }
  const id = identifier(draft.name, "view");
  return serializeMarkdownDocument(
    {
      type: "view",
      id,
      version: 1,
      name: draft.name,
      query: { types: ["task"] },
      views: [canonicalView({ ...draft, id })],
    },
    "",
  );
}

export function removeViewFromDocument(
  source: TaskViewSourceDocument,
  viewId: string,
): { document?: string; deleteSource: boolean } {
  if (source.format === "obsidian.base") {
    const document = parseDocument(source.document);
    const views = document.get("views", true);
    if (!isSeq(views)) throw new Error("This view source has no views list.");
    const index = findObsidianIndex(
      views.items.map((item) =>
        isMap(item) ? String(item.get("name") ?? "") : "",
      ),
      viewId,
    );
    if (index < 0)
      throw new Error("This view is no longer in its source file.");
    if (views.items.length === 1) return { deleteSource: true };
    views.items.splice(index, 1);
    return { document: String(document), deleteSource: false };
  }
  const parsed = parseFrontmatter(source.document);
  const frontmatter = record(parsed.frontmatter);
  const views = objectList(frontmatter.views);
  const next = views.filter((view) => view.id !== viewId);
  if (next.length === views.length)
    throw new Error("This view is no longer in its source file.");
  if (!next.length) return { deleteSource: true };
  frontmatter.views = next;
  return {
    document: serializeMarkdownDocument(frontmatter, parsed.body),
    deleteSource: false,
  };
}

export function emptyViewDraft(dialect: ViewDialect): EditableViewDraft {
  return {
    id: "view",
    name: "New view",
    renderer: "tasknotes.task-list",
    properties: ["status", "due"],
    sort: [],
    groupDirection: "asc",
    options: {},
    dialect,
    availableProperties: [],
  };
}

function readObsidianDraft(source: string, viewId: string): EditableViewDraft {
  const document = parseDocument(source);
  if (document.errors.length) throw new Error(document.errors[0].message);
  const value = record(document.toJS());
  const views = objectList(value.views);
  const index = findObsidianIndex(
    views.map((view) => string(view.name)),
    viewId,
  );
  const view = views[index];
  if (!view) throw new Error("This view is no longer in its source file.");
  const formulas = Object.keys(record(value.formulas)).map(
    (name) => `formula.${name}`,
  );
  const properties = stringList(view.order);
  const sort = obsidianSort(view.sort);
  const grouping = groupProperty(view.groupBy);
  return {
    id: viewId,
    name: string(view.name) || "View",
    renderer: editableRenderer(string(view.type)),
    filter: view.filters,
    properties,
    sort,
    groupProperty: grouping,
    groupDirection: direction(record(view.groupBy).direction),
    options: record(view.options),
    dialect: "obsidian-bases",
    availableProperties: [
      ...new Set([
        ...Object.keys(record(value.properties)),
        ...formulas,
        ...properties,
        ...sort.map(({ property }) => property),
        ...(grouping ? [grouping] : []),
      ]),
    ],
  };
}

function updateObsidianDocument(
  source: string,
  draft: EditableViewDraft,
): string {
  const document = parseDocument(source);
  if (document.errors.length) throw new Error(document.errors[0].message);
  const views = document.get("views", true);
  if (!isSeq(views)) throw new Error("This view source has no views list.");
  const index = findObsidianIndex(
    views.items.map((item) =>
      isMap(item) ? String(item.get("name") ?? "") : "",
    ),
    draft.id,
  );
  const view = views.items[index];
  if (!isMap(view))
    throw new Error("This view is no longer in its source file.");
  setOrDelete(view, "name", draft.name);
  setOrDelete(view, "type", obsidianRenderer(draft.renderer));
  setOrDelete(view, "filters", draft.filter);
  setOrDelete(
    view,
    "order",
    draft.properties.length ? draft.properties : undefined,
  );
  setOrDelete(
    view,
    "groupBy",
    supportsGrouping(draft.renderer) && draft.groupProperty
      ? {
          property: draft.groupProperty,
          direction: draft.groupDirection.toUpperCase(),
        }
      : undefined,
  );
  setOrDelete(
    view,
    "sort",
    draft.sort.length
      ? draft.sort.map((sort) => ({
          property: sort.property,
          direction: sort.direction.toUpperCase(),
        }))
      : undefined,
  );
  setOrDelete(
    view,
    "options",
    Object.keys(draft.options).length ? draft.options : undefined,
  );
  return String(document);
}

function readCanonicalDraft(source: string, viewId: string): EditableViewDraft {
  const parsed = parseFrontmatter(source);
  const frontmatter = record(parsed.frontmatter);
  const view = objectList(frontmatter.views).find(
    (candidate) => candidate.id === viewId,
  );
  if (!view) throw new Error("This view is no longer in its source file.");
  const query = record(frontmatter.query);
  const projections = {
    ...record(query.projections),
    ...record(view.projections),
  };
  const properties = stringList(view.select);
  const sort = canonicalSort(view.order_by);
  const grouping = string(objectList(view.group_by)[0]?.field) || undefined;
  return {
    id: viewId,
    name: string(view.name) || "View",
    renderer: editableRenderer(string(record(view.presentation).type)),
    filter: view.where,
    properties,
    sort,
    groupProperty: grouping,
    groupDirection: direction(objectList(view.group_by)[0]?.direction),
    options: record(record(view.presentation).options),
    dialect: "mdbase-cel",
    availableProperties: [
      ...new Set([
        ...Object.keys(record(frontmatter.properties)),
        ...Object.keys(projections).map((name) => `projection.${name}`),
        ...properties,
        ...sort.map(({ property }) => property),
        ...(grouping ? [grouping] : []),
      ]),
    ],
  };
}

function updateCanonicalDocument(
  source: string,
  draft: EditableViewDraft,
): string {
  const parsed = parseFrontmatter(source);
  const frontmatter = record(parsed.frontmatter);
  const views = objectList(frontmatter.views);
  const index = views.findIndex((view) => view.id === draft.id);
  if (index < 0) throw new Error("This view is no longer in its source file.");
  const current = views[index];
  const generated = canonicalView(draft);
  const currentPresentation = record(current.presentation);
  const generatedPresentation = record(generated.presentation);
  const currentMappings = record(currentPresentation.mappings);
  const generatedMappings = record(generatedPresentation.mappings);
  const mappings = { ...currentMappings, ...generatedMappings };
  if (draft.renderer !== "tasknotes.kanban") delete mappings.column;
  const presentation: Record<string, unknown> = {
    ...currentPresentation,
    ...generatedPresentation,
    ...(Object.keys(mappings).length ? { mappings } : {}),
  };
  if (!Object.keys(mappings).length) delete presentation.mappings;
  if (!Object.keys(draft.options).length) delete presentation.options;
  const updated: Record<string, unknown> = {
    ...current,
    ...generated,
    presentation,
  };
  if (typeof draft.filter !== "string" || !draft.filter.trim())
    delete updated.where;
  if (!supportsGrouping(draft.renderer) || !draft.groupProperty)
    delete updated.group_by;
  if (!draft.sort.length) delete updated.order_by;
  views[index] = updated;
  frontmatter.views = views;
  return serializeMarkdownDocument(frontmatter, parsed.body);
}

function obsidianView(draft: EditableViewDraft): Record<string, unknown> {
  return compact({
    type: obsidianRenderer(draft.renderer),
    name: draft.name,
    filters: draft.filter,
    order: draft.properties,
    sort: draft.sort.length
      ? draft.sort.map((sort) => ({
          property: sort.property,
          direction: sort.direction.toUpperCase(),
        }))
      : undefined,
    groupBy:
      supportsGrouping(draft.renderer) && draft.groupProperty
        ? {
            property: draft.groupProperty,
            direction: draft.groupDirection.toUpperCase(),
          }
        : undefined,
    options: Object.keys(draft.options).length ? draft.options : undefined,
  });
}

function canonicalView(draft: EditableViewDraft): Record<string, unknown> {
  const mappings =
    draft.renderer === "tasknotes.kanban" && draft.groupProperty
      ? { column: draft.groupProperty }
      : {};
  return compact({
    id: draft.id,
    name: draft.name,
    where:
      typeof draft.filter === "string" && draft.filter.trim()
        ? draft.filter
        : undefined,
    select: draft.properties.length ? draft.properties : ["title"],
    order_by: draft.sort.length
      ? draft.sort.map((sort) => ({
          field: sort.property,
          direction: sort.direction,
        }))
      : undefined,
    group_by:
      supportsGrouping(draft.renderer) && draft.groupProperty
        ? [{ field: draft.groupProperty, direction: draft.groupDirection }]
        : undefined,
    presentation: {
      type: draft.renderer,
      fallback: "mdbase.table",
      ...(Object.keys(mappings).length ? { mappings } : {}),
      ...(Object.keys(draft.options).length ? { options: draft.options } : {}),
    },
  });
}

function findObsidianIndex(names: string[], target: string): number {
  return stableIds(names).indexOf(target);
}

function stableIds(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const base = identifier(name, "view");
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
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

function groupProperty(value: unknown): string | undefined {
  return typeof value === "string"
    ? value
    : string(record(value).property) || undefined;
}

function obsidianSort(value: unknown): EditableViewSort[] {
  return objectList(value).flatMap((sort) => {
    const property = string(sort.property);
    return property ? [{ property, direction: direction(sort.direction) }] : [];
  });
}

function canonicalSort(value: unknown): EditableViewSort[] {
  return objectList(value).flatMap((sort) => {
    const property = string(sort.field);
    return property ? [{ property, direction: direction(sort.direction) }] : [];
  });
}

function direction(value: unknown): "asc" | "desc" {
  return typeof value === "string" && value.toLocaleLowerCase() === "desc"
    ? "desc"
    : "asc";
}

function supportsGrouping(renderer: ViewRenderer): boolean {
  return !isCalendarRenderer(renderer) && renderer !== "tasknotes.projects";
}

function setOrDelete(map: YAMLMap, key: string, value: unknown): void {
  if (value === undefined) map.delete(key);
  else map.set(key, value);
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (structuredClone(value) as Record<string, unknown>)
    : {};
}

function objectList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

import { taskViewKey } from "../domain/view";
import { normalizePresentationType } from "../domain/view-renderer";
import { recordLabel } from "../domain/completion";

import type { Task } from "../domain/task";
import type {
  TaskView,
  TaskViewDocument,
  TaskViewExecution,
  TaskViewGroup,
} from "../domain/view";

export interface ProviderViewList {
  views: Array<{
    id: string;
    name: string;
    source: TaskView["source"];
    views: Array<{
      id: string;
      name: string;
      properties?: TaskView["properties"];
      sort?: Array<{
        property?: string;
        column?: string;
        field?: string;
        direction?: string;
      }>;
      order_by?: Array<{
        property?: string;
        column?: string;
        field?: string;
        direction?: string;
      }>;
      presentation?: {
        type: string;
        fallback?: string;
        mappings?: Record<string, string>;
        options?: Record<string, unknown>;
      };
    }>;
  }>;
}

export interface ProviderViewExecution {
  results: Array<{
    path: string;
    effective_frontmatter: Record<string, unknown>;
    body?: string;
    types?: string[];
    values?: Record<string, unknown>;
  }>;
  meta: {
    total_count: number;
    has_more: boolean;
    groups?: TaskViewGroup[];
  };
}

export function normalizeViewDocuments(
  result: ProviderViewList,
): TaskViewDocument[] {
  return result.views.map((document) => ({
    id: document.id,
    name: document.name,
    source: { ...document.source },
    views: document.views.map((view) => ({
      key: taskViewKey(document.source.path, view.id),
      documentId: document.id,
      documentName: document.name,
      id: view.id,
      name: view.name,
      properties: structuredClone(view.properties ?? []),
      sort: providerSort(view.sort ?? view.order_by),
      source: { ...document.source },
      ...(view.presentation
        ? {
            presentation: {
              type: normalizePresentationType(view.presentation.type),
              ...(view.presentation.fallback
                ? { fallback: view.presentation.fallback }
                : {}),
              mappings: { ...(view.presentation.mappings ?? {}) },
              options: structuredClone(view.presentation.options ?? {}),
            },
          }
        : {}),
    })),
  }));
}

function providerSort(
  value:
    | Array<{
        property?: string;
        column?: string;
        field?: string;
        direction?: string;
      }>
    | undefined,
): NonNullable<TaskView["sort"]> {
  return (value ?? []).flatMap((sort) => {
    const property = sort.property ?? sort.column ?? sort.field;
    return property
      ? [
          {
            property,
            direction:
              sort.direction?.toLocaleLowerCase() === "desc"
                ? ("desc" as const)
                : ("asc" as const),
          },
        ]
      : [];
  });
}

export function normalizeViewExecution(
  view: TaskView,
  result: ProviderViewExecution,
  readTask: (record: ProviderViewExecution["results"][number]) => Task | null,
): TaskViewExecution {
  const normalizedView = inferExecutionPresentationMapping(view, result);
  const rows = result.results.flatMap((record) => {
    assertEffectiveFrontmatter(record);
    const task = readTask(record);
    return task ? [{ task, values: structuredClone(record.values ?? {}) }] : [];
  });
  return {
    view: normalizedView,
    rows,
    records: result.results.map((record) => {
      assertEffectiveFrontmatter(record);
      const frontmatter = record.effective_frontmatter;
      return {
        record: {
          path: record.path,
          label: recordLabel({ path: record.path, frontmatter }),
          frontmatter: structuredClone(frontmatter),
          ...(record.body === undefined ? {} : { body: record.body }),
          types: [...(record.types ?? [])],
        },
        values: structuredClone(record.values ?? {}),
      };
    }),
    totalCount: result.meta.total_count,
    hasMore: result.meta.has_more,
    groups: structuredClone(result.meta.groups ?? []),
  };
}

function assertEffectiveFrontmatter(
  record: ProviderViewExecution["results"][number],
): void {
  const value = record.effective_frontmatter;
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      `Invalid saved-view record "${record.path}": effective_frontmatter must be an object.`,
    );
}

function inferExecutionPresentationMapping(
  view: TaskView,
  result: ProviderViewExecution,
): TaskView {
  const presentation = view.presentation;
  if (presentation?.type !== "tasknotes.kanban" || presentation.mappings.column)
    return view;

  const groupProperties = new Set(
    (result.meta.groups ?? []).flatMap((group) =>
      Object.keys(group.values ?? {}),
    ),
  );
  if (groupProperties.size !== 1) return view;

  return {
    ...view,
    presentation: {
      ...presentation,
      mappings: {
        ...presentation.mappings,
        column: [...groupProperties][0],
      },
    },
  };
}

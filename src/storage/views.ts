import { taskViewKey } from "../domain/view";

import type { Task } from "../domain/task";
import type {
  TaskView,
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
    frontmatter?: Record<string, unknown>;
    raw_frontmatter?: Record<string, unknown>;
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

export function flattenViews(result: ProviderViewList): TaskView[] {
  return result.views.flatMap((document) =>
    document.views.map((view) => ({
      key: taskViewKey(document.source.path, view.id),
      documentId: document.id,
      documentName: document.name,
      id: view.id,
      name: view.name,
      source: { ...document.source },
      ...(view.presentation
        ? {
            presentation: {
              type: view.presentation.type,
              ...(view.presentation.fallback
                ? { fallback: view.presentation.fallback }
                : {}),
              mappings: { ...(view.presentation.mappings ?? {}) },
              options: structuredClone(view.presentation.options ?? {}),
            },
          }
        : {}),
    })),
  );
}

export function normalizeViewExecution(
  view: TaskView,
  result: ProviderViewExecution,
  readTask: (record: ProviderViewExecution["results"][number]) => Task | null,
): TaskViewExecution {
  const rows = result.results.flatMap((record) => {
    const task = readTask(record);
    return task ? [{ task, values: structuredClone(record.values ?? {}) }] : [];
  });
  return {
    view,
    rows,
    totalCount: result.meta.total_count,
    hasMore: result.meta.has_more,
    groups: structuredClone(result.meta.groups ?? []),
  };
}

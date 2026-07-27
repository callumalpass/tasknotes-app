import type { Task } from "./task";
import type { CollectionRecord } from "./completion";

export interface TaskViewPresentation {
  type: string;
  fallback?: string;
  mappings: Record<string, string>;
  options: Record<string, unknown>;
}

export interface TaskView {
  key: string;
  documentId: string;
  documentName: string;
  id: string;
  name: string;
  properties: TaskViewProperty[];
  sort?: TaskViewSort[];
  source: {
    path: string;
    format: string;
    revision: string;
    writable: boolean;
  };
  presentation?: TaskViewPresentation;
}

export interface TaskViewSort {
  property: string;
  direction: "asc" | "desc";
}

export interface TaskViewDocument {
  id: string;
  name: string;
  source: TaskView["source"];
  views: TaskView[];
}

export interface TaskViewProperty {
  key: string;
  label?: string;
  description?: string;
  format?: string;
  hidden?: boolean;
}

export interface TaskViewRow {
  task: Task;
  values: Record<string, unknown>;
}

export interface TaskViewGroup {
  values: Record<string, unknown>;
  count: number;
  summaries: Record<string, unknown>;
}

export interface TaskViewExecution {
  view: TaskView;
  rows: TaskViewRow[];
  records?: Array<{
    record: CollectionRecord;
    values: Record<string, unknown>;
  }>;
  totalCount: number;
  hasMore: boolean;
  groups: TaskViewGroup[];
  stale?: boolean;
}

export interface TaskViewSourceDocument {
  path: string;
  format: string;
  revision: string;
  document: string;
}

export interface CreateTaskViewSourceInput {
  document: string;
  path?: string;
  format?: string;
  name?: string;
}

export interface UpdateTaskViewSourceInput {
  path: string;
  document: string;
  ifRevision?: string;
}

export function taskViewKey(path: string, id: string): string {
  return `${path}#${id}`;
}

export function flattenViewDocuments(
  documents: readonly TaskViewDocument[],
): TaskView[] {
  return documents.flatMap((document) => document.views);
}

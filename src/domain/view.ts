import type { Task } from "./task";

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
  source: {
    path: string;
    format: string;
    revision: string;
    writable: boolean;
  };
  presentation?: TaskViewPresentation;
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

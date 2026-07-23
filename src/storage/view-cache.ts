import Dexie, { type Table } from "dexie";

import type {
  TaskView,
  TaskViewDocument,
  TaskViewExecution,
} from "../domain/view";

interface ViewCacheEntry {
  key: string;
  value: unknown;
}

export class TaskViewCache extends Dexie {
  private readonly entries!: Table<ViewCacheEntry, string>;

  constructor(collectionId: string) {
    super(`tasknotes-views:${collectionId}`);
    this.version(1).stores({ entries: "key" });
    this.entries = this.table("entries");
  }

  async readViewDocuments(): Promise<TaskViewDocument[]> {
    const value = (await this.entries.get("views"))?.value;
    if (!Array.isArray(value)) return [];
    if (value.every(isViewDocument))
      return clone<TaskViewDocument[]>(value, []).map(normalizeDocument);
    return groupLegacyViews(clone<TaskView[]>(value, []).map(normalizeView));
  }

  async writeViewDocuments(documents: TaskViewDocument[]): Promise<void> {
    await this.entries.put({
      key: "views",
      value: structuredClone(documents),
    });
  }

  async readExecution(key: string): Promise<TaskViewExecution | null> {
    const execution = clone<TaskViewExecution | null>(
      (await this.entries.get(`execution:${key}`))?.value,
      null,
    );
    return execution
      ? { ...execution, view: normalizeView(execution.view) }
      : null;
  }

  async writeExecution(execution: TaskViewExecution): Promise<void> {
    await this.entries.put({
      key: `execution:${execution.view.key}`,
      value: structuredClone(execution),
    });
  }
}

function normalizeView(view: TaskView): TaskView {
  const properties = (view as Partial<TaskView>).properties;
  return {
    ...view,
    properties: Array.isArray(properties) ? structuredClone(properties) : [],
  };
}

function normalizeDocument(document: TaskViewDocument): TaskViewDocument {
  return {
    ...document,
    source: { ...document.source },
    views: document.views.map(normalizeView),
  };
}

function isViewDocument(value: unknown): value is TaskViewDocument {
  return (
    value !== null &&
    typeof value === "object" &&
    Array.isArray((value as Partial<TaskViewDocument>).views)
  );
}

function groupLegacyViews(views: TaskView[]): TaskViewDocument[] {
  const documents = new Map<string, TaskViewDocument>();
  for (const view of views) {
    const existing = documents.get(view.source.path);
    if (existing) {
      existing.views.push(view);
      continue;
    }
    documents.set(view.source.path, {
      id: view.documentId,
      name: view.documentName,
      source: { ...view.source },
      views: [view],
    });
  }
  return [...documents.values()];
}

function clone<T>(value: unknown, fallback: T): T {
  return value === undefined ? fallback : (structuredClone(value) as T);
}

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

  async readExecution(
    view: Pick<TaskView, "key" | "source">,
  ): Promise<TaskViewExecution | null> {
    const value =
      (await this.entries.get(executionKey(view.key, view.source.revision)))
        ?.value ??
      // Read the pre-revision cache once for a seamless migration.
      (await this.entries.get(`execution:${view.key}`))?.value;
    const execution = clone<TaskViewExecution | null>(value, null);
    if (
      !execution ||
      execution.view.key !== view.key ||
      execution.view.source.revision !== view.source.revision
    )
      return null;
    return { ...execution, view: normalizeView(execution.view) };
  }

  async writeExecution(execution: TaskViewExecution): Promise<void> {
    await this.entries.put({
      key: executionKey(execution.view.key, execution.view.source.revision),
      value: structuredClone(execution),
    });
  }
}

function executionKey(key: string, revision: string): string {
  return `execution:${key}:${revision}`;
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

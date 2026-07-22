import Dexie, { type Table } from "dexie";

import type { TaskView, TaskViewExecution } from "../domain/view";

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

  async readViews(): Promise<TaskView[]> {
    return clone<TaskView[]>((await this.entries.get("views"))?.value, []).map(
      normalizeView,
    );
  }

  async writeViews(views: TaskView[]): Promise<void> {
    await this.entries.put({ key: "views", value: structuredClone(views) });
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

function clone<T>(value: unknown, fallback: T): T {
  return value === undefined ? fallback : (structuredClone(value) as T);
}

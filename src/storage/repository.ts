import {
  indexTask,
  TaskIndex,
  withoutIndexFields,
  type IndexedTask,
} from "./index";
import { batches, MarkdownCollection } from "./collection";
import { createPlatformVault } from "./vault";
import { LocalViewExecutor } from "./local-views";

import type {
  CreateTaskInput,
  Task,
  TaskListQuery,
  TaskStats,
  UpdateTaskInput,
  TaskTimeEntry,
} from "../domain/task";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskView, TaskViewExecution } from "../domain/view";

export interface CollectionInfo {
  kind: "local" | "connect";
  name: string;
  location: string;
  runtime: "browser" | "native";
}

export interface TaskRepository {
  initialize(): Promise<void>;
  refresh(): Promise<RefreshResult>;
  list(query?: TaskListQuery): Promise<Task[]>;
  get(id: string): Promise<Task | null>;
  create(input: CreateTaskInput): Promise<Task>;
  update(id: string, input: UpdateTaskInput): Promise<Task>;
  toggle(id: string, occurrenceDate?: string): Promise<Task>;
  skip(id: string, occurrenceDate: string): Promise<Task>;
  startTimeTracking(id: string, description?: string): Promise<Task>;
  stopTimeTracking(id: string): Promise<Task>;
  replaceTimeEntries(id: string, entries: TaskTimeEntry[]): Promise<Task>;
  removeTimeEntry(id: string, index: number): Promise<Task>;
  delete(id: string): Promise<void>;
  stats(): Promise<TaskStats>;
  listViews(): Promise<TaskView[]>;
  executeView(view: TaskView): Promise<TaskViewExecution>;
  taskConfiguration(): Promise<TaskCollectionConfiguration>;
  collectionInfo(): Promise<CollectionInfo>;
  syncStatus(): Promise<RepositorySyncStatus>;
  syncIssues(): Promise<RepositorySyncIssue[]>;
  resolveSyncIssue(id: string, resolution: "local" | "remote"): Promise<void>;
  subscribe?(listener: () => void): () => void;
}

export interface RepositorySyncStatus {
  mode: "local" | "live" | "replicated";
  state: "local" | "synced" | "syncing" | "offline" | "issues";
  pending: number;
  issues: number;
  lastSyncedAt?: string;
  message?: string;
}

export interface RepositorySyncIssue {
  id: string;
  path?: string;
  title: string;
  message: string;
  canKeepLocal: boolean;
}

export interface RefreshResult {
  scanned: number;
  changed: number;
  removed: number;
  elapsedMs: number;
}

export class IndexedMarkdownRepository implements TaskRepository {
  private readonly collection: MarkdownCollection;
  private readonly index: TaskIndex;
  private readonly cache = new Map<string, IndexedTask>();
  private initialization: Promise<void> | null = null;
  private writeTail: Promise<void> = Promise.resolve();
  private readonly views: LocalViewExecutor;

  constructor(
    options: { collection?: MarkdownCollection; index?: TaskIndex } = {},
  ) {
    this.collection =
      options.collection ?? new MarkdownCollection(createPlatformVault());
    this.index = options.index ?? new TaskIndex();
    this.views = new LocalViewExecutor(this.collection, () => [
      ...this.cache.values(),
    ]);
  }

  initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.exclusive(async () => {
        await this.collection.initialize();
        const cached = await this.index.tasks.toArray();
        for (const task of cached) this.cache.set(task.id, task);
        if (!cached.length) await this.refreshUnlocked();
      });
    }
    return this.initialization;
  }

  refresh(): Promise<RefreshResult> {
    return this.exclusive(() => this.refreshUnlocked());
  }

  async list(query: TaskListQuery = {}): Promise<Task[]> {
    const tokens = (query.search ?? "")
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const tasks = [...this.cache.values()]
      .filter((task) => {
        if (query.status === "completed" && !task.completed) return false;
        if (
          query.status !== "completed" &&
          query.status !== "all" &&
          task.completed
        )
          return false;
        return tokens.every((token) => task.searchText.includes(token));
      })
      .sort(compareTasks)
      .slice(0, query.limit ?? 500)
      .map(withoutIndexFields);
    return tasks;
  }

  async get(id: string): Promise<Task | null> {
    const task = this.cache.get(id);
    return task ? withoutIndexFields(task) : null;
  }

  create(input: CreateTaskInput): Promise<Task> {
    return this.exclusive(async () => {
      const task = this.collection.createTask(
        input,
        crypto.randomUUID(),
        new Date().toISOString(),
      );
      await this.write(task);
      return task;
    });
  }

  update(id: string, input: UpdateTaskInput): Promise<Task> {
    return this.exclusive(async () => {
      const current = await this.get(id);
      if (!current) throw new Error("Task not found.");
      const next = this.collection.updateTask(
        current,
        input,
        new Date().toISOString(),
      );
      await this.write(next);
      return next;
    });
  }

  toggle(id: string, occurrenceDate?: string): Promise<Task> {
    return this.exclusive(async () => {
      const current = await this.get(id);
      if (!current) throw new Error("Task not found.");
      const next = this.collection.toggleTask(
        current,
        new Date().toISOString(),
        occurrenceDate,
      );
      await this.write(next);
      return next;
    });
  }

  skip(id: string, occurrenceDate: string): Promise<Task> {
    return this.exclusive(async () => {
      const current = await this.get(id);
      if (!current) throw new Error("Task not found.");
      const next = this.collection.skipTask(
        current,
        new Date().toISOString(),
        occurrenceDate,
      );
      await this.write(next);
      return next;
    });
  }

  startTimeTracking(id: string, description?: string): Promise<Task> {
    return this.exclusive(async () => {
      const current = await this.get(id);
      if (!current) throw new Error("Task not found.");
      const next = this.collection.startTimeTracking(
        current,
        new Date().toISOString(),
        description,
      );
      await this.write(next);
      return next;
    });
  }

  stopTimeTracking(id: string): Promise<Task> {
    return this.exclusive(async () => {
      const current = await this.get(id);
      if (!current) throw new Error("Task not found.");
      const next = this.collection.stopTimeTracking(
        current,
        new Date().toISOString(),
      );
      await this.write(next);
      return next;
    });
  }

  replaceTimeEntries(id: string, entries: TaskTimeEntry[]): Promise<Task> {
    return this.exclusive(async () => {
      const current = await this.get(id);
      if (!current) throw new Error("Task not found.");
      const next = this.collection.replaceTimeEntries(
        current,
        entries,
        new Date().toISOString(),
      );
      await this.write(next);
      return next;
    });
  }

  removeTimeEntry(id: string, index: number): Promise<Task> {
    return this.exclusive(async () => {
      const current = await this.get(id);
      if (!current) throw new Error("Task not found.");
      const next = this.collection.removeTimeEntry(
        current,
        index,
        new Date().toISOString(),
      );
      await this.write(next);
      return next;
    });
  }

  delete(id: string): Promise<void> {
    return this.exclusive(async () => {
      const current = this.cache.get(id);
      if (!current) return;
      await this.collection.delete(current.path);
      this.cache.delete(id);
      await this.index.tasks.delete(id);
    });
  }

  async stats(): Promise<TaskStats> {
    let completed = 0;
    for (const task of this.cache.values()) if (task.completed) completed += 1;
    return {
      total: this.cache.size,
      open: this.cache.size - completed,
      completed,
    };
  }

  listViews(): Promise<TaskView[]> {
    return this.views.list();
  }

  executeView(view: TaskView): Promise<TaskViewExecution> {
    return this.views.execute(view);
  }

  async taskConfiguration(): Promise<TaskCollectionConfiguration> {
    return this.collection.taskConfiguration();
  }

  async collectionInfo(): Promise<CollectionInfo> {
    return {
      kind: "local",
      name: "On this device",
      location: this.collection.location(),
      runtime: this.collection.kind(),
    };
  }

  async syncStatus(): Promise<RepositorySyncStatus> {
    return { mode: "local", state: "local", pending: 0, issues: 0 };
  }

  async syncIssues(): Promise<RepositorySyncIssue[]> {
    return [];
  }

  async resolveSyncIssue(): Promise<void> {
    throw new Error("This collection has no sync issues.");
  }

  private async refreshUnlocked(): Promise<RefreshResult> {
    const startedAt = performance.now();
    const documents = await this.collection.list();
    const storedByPath = new Map(
      [...this.cache.values()].map((task) => [task.path, task]),
    );
    const currentPaths = new Set(documents.map((document) => document.path));
    const changed = documents.filter((document) => {
      const cached = storedByPath.get(document.path);
      return (
        !cached ||
        cached.sourceMtime !== document.lastModified ||
        cached.sourceSize !== document.size
      );
    });
    const indexed: IndexedTask[] = [];
    const replacedIds = new Set<string>();
    for (const batch of batches(changed, 64)) {
      const read = await Promise.all(
        batch.map(async (document) => ({
          document,
          task: await this.collection.read(document),
        })),
      );
      for (const { document, task } of read) {
        const previous = storedByPath.get(document.path);
        if (previous && (!task || previous.id !== task.id))
          replacedIds.add(previous.id);
        if (task) indexed.push(indexTask(task, document));
      }
    }
    const removedIds = [...this.cache.values()]
      .filter((task) => !currentPaths.has(task.path))
      .map((task) => task.id);
    const allRemoved = [...new Set([...removedIds, ...replacedIds])];
    await this.index.transaction("rw", this.index.tasks, async () => {
      if (allRemoved.length) await this.index.tasks.bulkDelete(allRemoved);
      if (indexed.length) await this.index.tasks.bulkPut(indexed);
    });
    for (const id of allRemoved) this.cache.delete(id);
    for (const task of indexed) this.cache.set(task.id, task);
    return {
      scanned: documents.length,
      changed: changed.length,
      removed: allRemoved.length,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  }

  private async write(task: Task): Promise<void> {
    const source = await this.collection.write(task);
    const indexed = indexTask(task, source);
    await this.index.tasks.put(indexed);
    this.cache.set(task.id, indexed);
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeTail.then(operation, operation);
    this.writeTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export function compareTasks(left: Task, right: Task): number {
  if (left.completed !== right.completed) return left.completed ? 1 : -1;
  const leftDate = left.scheduled ?? left.due;
  const rightDate = right.scheduled ?? right.due;
  if (leftDate !== rightDate) {
    if (!leftDate) return 1;
    if (!rightDate) return -1;
    return leftDate.localeCompare(rightDate);
  }
  const priorities: Record<string, number> = { high: 0, normal: 1, low: 2 };
  const priority =
    (priorities[left.priority] ?? 3) - (priorities[right.priority] ?? 3);
  if (priority) return priority;
  const updated = right.updatedAt.localeCompare(left.updatedAt);
  return updated || left.path.localeCompare(right.path);
}

import {
  indexTask,
  TaskIndex,
  withoutIndexFields,
  type IndexedTask,
} from "./index";
import { batches, MarkdownCollection } from "./collection";
import { createPlatformVault } from "./vault";
import { LocalViewExecutor } from "./local-views";
import { archiveMoveWarning } from "../domain/task-archive";
import {
  findOccurrenceParent,
  findMaterializedOccurrenceTask,
  occurrenceRecordId,
  rollingOccurrenceDates,
} from "../domain/task-occurrence";

import type {
  CreateTaskInput,
  MaterializeOccurrenceResult,
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
  materializeOccurrence(
    parentId: string,
    occurrenceDate: string,
  ): Promise<MaterializeOccurrenceResult>;
  startTimeTracking(id: string, description?: string): Promise<Task>;
  stopTimeTracking(id: string): Promise<Task>;
  replaceTimeEntries(id: string, entries: TaskTimeEntry[]): Promise<Task>;
  removeTimeEntry(id: string, index: number): Promise<Task>;
  setArchived(id: string, archived: boolean): Promise<Task>;
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
        await this.maintainRollingOccurrencesUnlocked();
      });
    }
    return this.initialization;
  }

  refresh(): Promise<RefreshResult> {
    return this.exclusive(async () => {
      const result = await this.refreshUnlocked();
      await this.maintainRollingOccurrencesUnlocked();
      return result;
    });
  }

  async list(query: TaskListQuery = {}): Promise<Task[]> {
    const tokens = (query.search ?? "")
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const tasks = [...this.cache.values()]
      .filter((task) => {
        if (!matchesArchiveFilter(task, query)) return false;
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
      const task = await this.collection.createTask(
        input,
        crypto.randomUUID(),
        new Date().toISOString(),
      );
      await this.write(task);
      return this.withRollingWarnings(task);
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
      return this.withRollingWarnings(next);
    });
  }

  toggle(id: string, occurrenceDate?: string): Promise<Task> {
    return this.exclusive(async () => {
      const current = await this.get(id);
      if (!current) throw new Error("Task not found.");
      if (current.recurrenceParent && current.occurrenceDate)
        return this.transitionMaterializedUnlocked(current, "toggle");
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
      if (current.recurrenceParent && current.occurrenceDate)
        return this.transitionMaterializedUnlocked(current, "skip");
      const next = this.collection.skipTask(
        current,
        new Date().toISOString(),
        occurrenceDate,
      );
      await this.write(next);
      return next;
    });
  }

  materializeOccurrence(
    parentId: string,
    occurrenceDate: string,
  ): Promise<MaterializeOccurrenceResult> {
    return this.exclusive(() =>
      this.materializeOccurrenceUnlocked(parentId, occurrenceDate),
    );
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

  setArchived(id: string, archived: boolean): Promise<Task> {
    return this.exclusive(async () => {
      const current = await this.get(id);
      if (!current) throw new Error("Task not found.");
      const next = this.collection.updateTask(
        current,
        { archived },
        new Date().toISOString(),
      );
      await this.write(next);
      const destination = this.collection.archiveDestination(next, archived);
      if (!destination) return next;
      try {
        const source = await this.collection.rename(next.path, destination);
        const moved = { ...next, path: destination };
        const indexed = indexTask(moved, source);
        await this.index.tasks.put(indexed);
        this.cache.set(id, indexed);
        return moved;
      } catch (reason) {
        const warning = archiveMoveWarning(reason, archived);
        const retained = { ...next, operationWarnings: [warning] };
        const cached = this.cache.get(id);
        if (cached) this.cache.set(id, { ...cached, ...retained });
        return retained;
      }
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
    let archived = 0;
    let completed = 0;
    let open = 0;
    for (const task of this.cache.values()) {
      if (task.archived) archived += 1;
      else if (task.completed) completed += 1;
      else open += 1;
    }
    return {
      total: open + completed,
      open,
      completed,
      archived,
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

  private async materializeOccurrenceUnlocked(
    parentId: string,
    occurrenceDate: string,
  ): Promise<MaterializeOccurrenceResult> {
    const parent = this.cache.get(parentId);
    if (!parent) throw new Error("Task not found.");
    const existing = [...this.cache.values()].filter(
      (task) => task.recurrenceParent && task.occurrenceDate,
    );
    const resolved = findMaterializedOccurrenceTask(
      [...this.cache.values()],
      parent,
      occurrenceDate,
    );
    if (resolved) return { task: resolved, created: false, warnings: [] };
    const result = await this.collection.materializeOccurrence(
      parent,
      occurrenceDate,
      existing,
      await occurrenceRecordId(parent.id, occurrenceDate),
      new Date().toISOString(),
    );
    if (!result.created) return result;
    const task = result.warnings.length
      ? { ...result.task, operationWarnings: result.warnings }
      : result.task;
    await this.write(task);
    return { ...result, task };
  }

  private async transitionMaterializedUnlocked(
    occurrence: Task,
    action: "toggle" | "skip",
  ): Promise<Task> {
    const parent = findOccurrenceParent([...this.cache.values()], occurrence);
    if (!parent)
      throw new Error(
        "invalid_recurrence_parent: The occurrence parent could not be resolved.",
      );
    const transition = this.collection.transitionMaterializedOccurrence(
      occurrence,
      parent,
      action,
      new Date().toISOString(),
    );
    await this.write(transition.occurrence);
    const warnings: string[] = [];
    try {
      await this.write(transition.parent);
    } catch (reason) {
      warnings.push(
        `occurrence_parent_reconciliation_failed: ${errorMessage(reason)}`,
      );
    }
    if (transition.materializeNextDate) {
      try {
        await this.materializeOccurrenceUnlocked(
          parent.id,
          transition.materializeNextDate,
        );
      } catch (reason) {
        warnings.push(
          `next_occurrence_materialization_failed: ${errorMessage(reason)}`,
        );
      }
    }
    if (!warnings.length) return transition.occurrence;
    const stored = { ...transition.occurrence, operationWarnings: warnings };
    const cached = this.cache.get(stored.id);
    if (cached) this.cache.set(stored.id, { ...cached, ...stored });
    return stored;
  }

  private async maintainRollingOccurrencesUnlocked(): Promise<string[]> {
    const warnings: string[] = [];
    const parents = [...this.cache.values()].filter(
      (task) => task.recurrence && task.occurrenceMaterialization === "rolling",
    );
    for (const parent of parents) {
      warnings.push(...(await this.materializeRollingWindow(parent)));
    }
    return warnings;
  }

  private async withRollingWarnings(task: Task): Promise<Task> {
    if (!task.recurrence || task.occurrenceMaterialization !== "rolling")
      return task;
    const warnings = await this.materializeRollingWindow(task);
    if (!warnings.length) return task;
    const retained = { ...task, operationWarnings: warnings };
    const cached = this.cache.get(task.id);
    if (cached) this.cache.set(task.id, { ...cached, ...retained });
    return retained;
  }

  private async materializeRollingWindow(task: Task): Promise<string[]> {
    let dates: string[];
    try {
      dates = rollingOccurrenceDates(task);
    } catch (reason) {
      return [
        `rolling_occurrence_materialization_failed: ${errorMessage(reason)}`,
      ];
    }
    const warnings: string[] = [];
    for (const date of dates) {
      try {
        await this.materializeOccurrenceUnlocked(task.id, date);
      } catch (reason) {
        warnings.push(
          `rolling_occurrence_materialization_failed: ${date}: ${errorMessage(reason)}`,
        );
      }
    }
    return warnings;
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

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
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

export function matchesArchiveFilter(
  task: Task,
  query: TaskListQuery,
): boolean {
  const filter = query.archived ?? "exclude";
  return (
    filter === "include" || (filter === "only" ? task.archived : !task.archived)
  );
}

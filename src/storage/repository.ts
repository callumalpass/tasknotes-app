import {
  indexTask,
  TaskIndex,
  withoutIndexFields,
  type IndexedTask,
} from "./index";
import { batches, MarkdownCollection } from "./collection";
import { createPlatformVault } from "./vault";
import { LocalViewExecutor } from "./local-views";
import { completeRecords, completeTaskValues } from "./completions";
import { archiveMoveWarning } from "../domain/task-archive";
import {
  findOccurrenceParent,
  findMaterializedOccurrenceTask,
  occurrenceRecordId,
  rollingOccurrenceDates,
} from "../domain/task-occurrence";
import { taskRelationships } from "../domain/task-relationships";

import type {
  CreateTaskInput,
  MaterializeOccurrenceResult,
  Task,
  TaskListQuery,
  TaskStats,
  UpdateTaskInput,
  TaskTimeEntry,
} from "../domain/task";
import type { TaskRelationships } from "../domain/task-relationships";
import type {
  TaskCollectionConfiguration,
  TaskModelSettingsAccess,
  TaskModelSettingsPatch,
} from "../domain/task-configuration";
import type {
  FieldCompletion,
  FieldCompletionRequest,
} from "../domain/completion";
import type {
  CreateTaskViewSourceInput,
  TaskView,
  TaskViewDocument,
  TaskViewExecution,
  TaskViewSourceDocument,
  UpdateTaskViewSourceInput,
} from "../domain/view";

export interface CollectionInfo {
  kind: "local" | "connect";
  id?: string;
  name: string;
  location: string;
  runtime: "browser" | "native";
}

export interface TaskRepository {
  initialize(): Promise<void>;
  refresh(): Promise<RefreshResult>;
  indexingProgress?(): RepositoryIndexingProgress;
  subscribeIndexing?(
    listener: (
      progress: RepositoryIndexingProgress,
      publishTasks: boolean,
    ) => void,
  ): () => void;
  list(query?: TaskListQuery): Promise<Task[]>;
  get(id: string): Promise<Task | null>;
  relationships(id: string): Promise<TaskRelationships>;
  completeField(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
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
  cachedViews(): Promise<TaskViewDocument[]>;
  listViews(): Promise<TaskViewDocument[]>;
  cachedViewExecution(view: TaskView): Promise<TaskViewExecution | null>;
  executeView(view: TaskView): Promise<TaskViewExecution>;
  readViewSource(path: string): Promise<TaskViewSourceDocument>;
  createViewSource(
    input: CreateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument>;
  updateViewSource(
    input: UpdateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument>;
  deleteViewSource(path: string, ifRevision?: string): Promise<void>;
  taskConfiguration(): Promise<TaskCollectionConfiguration>;
  taskModelSettingsAccess(): Promise<TaskModelSettingsAccess>;
  updateTaskModelSettings(
    patch: TaskModelSettingsPatch,
  ): Promise<TaskCollectionConfiguration>;
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

export interface RepositoryIndexingProgress {
  phase: "idle" | "scanning" | "indexing";
  completed: number;
  total: number;
  complete: boolean;
}

export class IndexedMarkdownRepository implements TaskRepository {
  private readonly collection: MarkdownCollection;
  private readonly index: TaskIndex;
  private readonly cache = new Map<string, IndexedTask>();
  private initialization: Promise<void> | null = null;
  private refreshInFlight: Promise<RefreshResult> | null = null;
  private writeTail: Promise<void> = Promise.resolve();
  private readonly views: LocalViewExecutor;
  private indexing: RepositoryIndexingProgress = {
    phase: "idle",
    completed: 0,
    total: 0,
    complete: true,
  };
  private readonly indexingListeners = new Set<
    (progress: RepositoryIndexingProgress, publishTasks: boolean) => void
  >();
  private mutationVersion = 0;
  private readonly pathMutationVersions = new Map<string, number>();

  constructor(
    options: { collection?: MarkdownCollection; index?: TaskIndex } = {},
  ) {
    this.collection =
      options.collection ??
      new MarkdownCollection(createPlatformVault(), {
        approveManagedTypeUpgrade: ({ message }) =>
          typeof globalThis.confirm === "function"
            ? globalThis.confirm(message)
            : false,
      });
    this.index =
      options.index ?? new TaskIndex(indexName(this.collection.identifier()));
    this.views = new LocalViewExecutor(
      this.collection,
      () => [...this.cache.values()],
      () => this.indexing.phase === "idle" && this.indexing.complete,
    );
  }

  initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.exclusive(async () => {
        await this.collection.initialize();
        const [cached, storedProjection] = await Promise.all([
          this.index.tasks.toArray(),
          this.index.metadata.get("projection"),
        ]);
        for (const task of cached) {
          this.cache.set(task.id, task);
          this.collection.cacheTaskRecord(task, {
            lastModified: task.sourceMtime,
            size: task.sourceSize,
          });
        }
        const complete = cached.length
          ? (storedProjection?.complete ?? true)
          : false;
        await this.index.metadata.put({ key: "projection", complete });
        if (!complete)
          this.publishIndexing(
            {
              phase: "scanning",
              completed: 0,
              total: 0,
              complete: false,
            },
            false,
          );
        await this.maintainRollingOccurrencesUnlocked();
      });
    }
    return this.initialization;
  }

  refresh(): Promise<RefreshResult> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.publishIndexing(
      {
        phase: "scanning",
        completed: 0,
        total: 0,
        complete: this.indexing.complete,
      },
      false,
    );
    const run = this.refreshProgressively()
      .catch((reason: unknown) => {
        this.publishIndexing(
          {
            phase: "idle",
            completed: this.indexing.completed,
            total: this.indexing.total,
            complete: this.indexing.complete,
          },
          false,
        );
        throw reason;
      })
      .finally(() => {
        if (this.refreshInFlight === run) this.refreshInFlight = null;
      });
    this.refreshInFlight = run;
    return run;
  }

  indexingProgress(): RepositoryIndexingProgress {
    return { ...this.indexing };
  }

  subscribeIndexing(
    listener: (
      progress: RepositoryIndexingProgress,
      publishTasks: boolean,
    ) => void,
  ): () => void {
    this.indexingListeners.add(listener);
    return () => this.indexingListeners.delete(listener);
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

  async relationships(id: string): Promise<TaskRelationships> {
    const current = this.cache.get(id);
    if (!current) throw new Error("Task not found.");
    return taskRelationships(current, [...this.cache.values()]);
  }

  async completeField(
    request: FieldCompletionRequest,
  ): Promise<FieldCompletion[]> {
    if (request.kind === "values")
      return completeTaskValues(this.cache.values(), request);
    const configuration = this.collection.taskConfiguration();
    const records = await this.collection.findCollectionRecords(
      request.query ?? "",
      Math.max((request.limit ?? 12) * 4, 48),
    );
    return completeRecords(records, request, configuration.linkWriteFormat);
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
        this.markPathsChanged(next.path, destination);
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
      this.markPathsChanged(current.path);
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

  listViews(): Promise<TaskViewDocument[]> {
    return this.views.list();
  }

  cachedViews(): Promise<TaskViewDocument[]> {
    return Promise.resolve([]);
  }

  cachedViewExecution(): Promise<TaskViewExecution | null> {
    return Promise.resolve(null);
  }

  executeView(view: TaskView): Promise<TaskViewExecution> {
    return this.views.execute(view);
  }

  readViewSource(path: string): Promise<TaskViewSourceDocument> {
    return this.collection.readViewSource(path);
  }

  createViewSource(
    input: CreateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument> {
    return this.collection.createViewSource(input);
  }

  updateViewSource(
    input: UpdateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument> {
    return this.collection.updateViewSource(input);
  }

  deleteViewSource(path: string, ifRevision?: string): Promise<void> {
    return this.collection.deleteViewSource(path, ifRevision);
  }

  async taskConfiguration(): Promise<TaskCollectionConfiguration> {
    return this.collection.taskConfiguration();
  }

  async taskModelSettingsAccess(): Promise<TaskModelSettingsAccess> {
    return {
      writable: true,
      source: this.collection.taskModelSettingsSource(),
    };
  }

  updateTaskModelSettings(
    patch: TaskModelSettingsPatch,
  ): Promise<TaskCollectionConfiguration> {
    return this.exclusive(() => this.collection.updateTaskModelSettings(patch));
  }

  async collectionInfo(): Promise<CollectionInfo> {
    return {
      kind: "local",
      id: this.collection.identifier(),
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

  private async refreshProgressively(): Promise<RefreshResult> {
    const startedAt = performance.now();
    const plan = await this.exclusive(async () => {
      const configurationChanged = await this.collection.refreshConfiguration();
      const documents = await this.collection.list();
      const storedByPath = new Map(
        [...this.cache.values()].map((task) => [task.path, task]),
      );
      const currentPaths = new Set(documents.map((document) => document.path));
      const changed = documents.filter((document) => {
        const cached = storedByPath.get(document.path);
        return (
          configurationChanged ||
          !cached ||
          cached.sourceMtime !== document.lastModified ||
          cached.sourceSize !== document.size
        );
      });
      const removed = [...storedByPath.values()].filter(
        (task) => !currentPaths.has(task.path),
      );
      return {
        documents,
        changed,
        removed,
        storedByPath,
        mutationVersion: this.mutationVersion,
      };
    });
    let completed = plan.documents.length - plan.changed.length;
    let lastPublishedCompleted = completed;
    let lastPublishedAt = performance.now();
    const removedIds = new Set<string>();
    if (plan.changed.length)
      this.publishIndexing(
        {
          phase: "indexing",
          completed,
          total: plan.documents.length,
          complete: this.indexing.complete,
        },
        false,
      );
    for (const documentBatch of batches(plan.changed, 256)) {
      const batchRemoved = await this.exclusive(() =>
        this.indexDocumentBatch(
          documentBatch,
          plan.storedByPath,
          plan.mutationVersion,
        ),
      );
      for (const id of batchRemoved) removedIds.add(id);
      completed += documentBatch.length;
      const now = performance.now();
      const publishTasks =
        completed < plan.documents.length &&
        (lastPublishedCompleted ===
          plan.documents.length - plan.changed.length ||
          completed - lastPublishedCompleted >= 2_048 ||
          now - lastPublishedAt >= 500);
      if (publishTasks) {
        lastPublishedCompleted = completed;
        lastPublishedAt = now;
      }
      this.publishIndexing(
        {
          phase: "indexing",
          completed,
          total: plan.documents.length,
          complete: this.indexing.complete,
        },
        publishTasks,
      );
      if (completed < plan.documents.length) await yieldToMainThread();
    }
    const removed = await this.exclusive(async () => {
      const removable = plan.removed.filter((snapshot) => {
        if (this.pathChangedAfter(snapshot.path, plan.mutationVersion))
          return false;
        const current = this.cache.get(snapshot.id);
        return (
          current?.path === snapshot.path &&
          current.sourceMtime === snapshot.sourceMtime &&
          current.sourceSize === snapshot.sourceSize
        );
      });
      if (removable.length)
        await this.index.tasks.bulkDelete(removable.map((task) => task.id));
      for (const task of removable) {
        this.cache.delete(task.id);
        removedIds.add(task.id);
      }
      await this.maintainRollingOccurrencesUnlocked();
      await this.index.metadata.put({ key: "projection", complete: true });
      return removedIds.size;
    });
    this.publishIndexing(
      {
        phase: "idle",
        completed: plan.documents.length,
        total: plan.documents.length,
        complete: true,
      },
      false,
    );
    return {
      scanned: plan.documents.length,
      changed: plan.changed.length,
      removed,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  }

  private async indexDocumentBatch(
    documents: Awaited<ReturnType<MarkdownCollection["list"]>>,
    storedByPath: Map<string, IndexedTask>,
    planMutationVersion: number,
  ): Promise<Set<string>> {
    const eligible = documents.filter(
      (document) => !this.pathChangedAfter(document.path, planMutationVersion),
    );
    const indexed: IndexedTask[] = [];
    const replacedIds = new Set<string>();
    for (const readBatch of batches(eligible, 64)) {
      const read = await Promise.all(
        readBatch.map(async (document) => ({
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
    await this.index.transaction("rw", this.index.tasks, async () => {
      if (replacedIds.size) await this.index.tasks.bulkDelete([...replacedIds]);
      if (indexed.length) await this.index.tasks.bulkPut(indexed);
    });
    for (const id of replacedIds) this.cache.delete(id);
    for (const task of indexed) this.cache.set(task.id, task);
    return replacedIds;
  }

  private async write(task: Task): Promise<void> {
    const source = await this.collection.write(task);
    const indexed = indexTask(task, source);
    await this.index.tasks.put(indexed);
    this.cache.set(task.id, indexed);
    this.markPathsChanged(task.path);
  }

  private pathChangedAfter(path: string, version: number): boolean {
    return (this.pathMutationVersions.get(path) ?? 0) > version;
  }

  private markPathsChanged(...paths: string[]): void {
    this.mutationVersion += 1;
    for (const path of paths)
      this.pathMutationVersions.set(path, this.mutationVersion);
  }

  private publishIndexing(
    progress: RepositoryIndexingProgress,
    publishTasks: boolean,
  ): void {
    this.indexing = progress;
    for (const listener of this.indexingListeners)
      listener({ ...progress }, publishTasks);
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

function indexName(identifier: string): string {
  return identifier === "native-default" || identifier === "browser-default"
    ? "tasknotes-index-v2"
    : `tasknotes-index-v2:${identifier}`;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

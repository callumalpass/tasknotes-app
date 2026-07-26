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
import {
  pendingTaskDelete,
  pendingTaskMove,
  pendingTaskWrite,
  recordMutationFailure,
  type PendingLocalMutation,
  type PendingTaskMove,
} from "./mutation-outbox";

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

const PROJECTION_CONSISTENCY_VERSION = 1;

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
  private readonly rollingParentIds = new Set<string>();
  private readonly cachedStats: TaskStats = {
    total: 0,
    open: 0,
    completed: 0,
    archived: 0,
  };
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
  private skipNextPrivateBrowserRefresh = false;

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
        await this.replayPendingMutationsUnlocked();
        const [cached, storedProjection, pendingMutations] = await Promise.all([
          this.index.tasks.toArray(),
          this.index.metadata.get("projection"),
          this.index.mutations.count(),
        ]);
        for (const task of cached) {
          this.cacheTask(task);
          this.collection.cacheTaskRecord(task, {
            lastModified: task.sourceMtime,
            size: task.sourceSize,
          });
        }
        const complete = cached.length
          ? (storedProjection?.complete ?? true)
          : false;
        const consistencyVersion = storedProjection?.consistencyVersion;
        await this.index.metadata.put({
          key: "projection",
          complete,
          ...(consistencyVersion === undefined ? {} : { consistencyVersion }),
        });
        this.skipNextPrivateBrowserRefresh =
          complete &&
          consistencyVersion === PROJECTION_CONSISTENCY_VERSION &&
          pendingMutations === 0 &&
          this.collection.identifier() === "browser-default";
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
    if (this.skipNextPrivateBrowserRefresh) {
      this.skipNextPrivateBrowserRefresh = false;
      const result = {
        scanned: this.cache.size,
        changed: 0,
        removed: 0,
        elapsedMs: 0,
      };
      this.publishIndexing(
        {
          phase: "idle",
          completed: this.cache.size,
          total: this.cache.size,
          complete: true,
        },
        false,
      );
      return Promise.resolve(result);
    }
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
    const limit = Math.max(0, Math.floor(query.limit ?? 500));
    if (!limit) return [];
    const matches = (task: IndexedTask) => {
      if (!matchesArchiveFilter(task, query)) return false;
      if (query.status === "completed" && !task.completed) return false;
      if (
        query.status !== "completed" &&
        query.status !== "all" &&
        task.completed
      )
        return false;
      return tokens.every((token) => task.searchText.includes(token));
    };
    return selectFirstTasks(this.cache.values(), matches, limit).map(
      withoutIndexFields,
    );
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
      const destination = this.collection.archiveDestination(next, archived);
      if (!destination) {
        await this.write(next);
        return next;
      }
      const mutation = pendingTaskMove(next, destination);
      await this.index.mutations.put(mutation);
      try {
        return await this.applyMoveMutationUnlocked(mutation);
      } catch (reason) {
        if (!(reason instanceof LocalMoveFailure)) {
          await this.recordFailedMutationUnlocked(mutation, reason);
          throw reason;
        }
        await this.settleFailedMoveUnlocked(mutation, reason.source);
        const warning = archiveMoveWarning(reason, archived);
        const retained = { ...next, operationWarnings: [warning] };
        const cached = this.cache.get(id);
        if (cached) this.cacheTask({ ...cached, ...retained });
        return retained;
      }
    });
  }

  delete(id: string): Promise<void> {
    return this.exclusive(async () => {
      const current = this.cache.get(id);
      if (!current) return;
      const mutation = pendingTaskDelete(current);
      await this.index.mutations.put(mutation);
      try {
        await this.applyDeleteMutationUnlocked(mutation);
      } catch (reason) {
        await this.recordFailedMutationUnlocked(mutation, reason);
        throw reason;
      }
    });
  }

  async stats(): Promise<TaskStats> {
    return { ...this.cachedStats };
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
    const pending = await this.index.mutations.count();
    return {
      mode: "local",
      state: "local",
      pending,
      issues: 0,
      ...(pending
        ? {
            message:
              "Some local changes are waiting to be written to Markdown. TaskNotes will retry them automatically.",
          }
        : {}),
    };
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
      await this.replayPendingMutationsUnlocked();
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
        this.removeCachedTask(task.id);
        removedIds.add(task.id);
      }
      await this.maintainRollingOccurrencesUnlocked();
      await this.index.metadata.put({
        key: "projection",
        complete: true,
        consistencyVersion: PROJECTION_CONSISTENCY_VERSION,
      });
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
    for (const id of replacedIds) this.removeCachedTask(id);
    for (const task of indexed) this.cacheTask(task);
    return replacedIds;
  }

  private async write(task: Task): Promise<void> {
    const mutation = pendingTaskWrite(task);
    await this.index.mutations.put(mutation);
    try {
      await this.applyWriteMutationUnlocked(mutation);
    } catch (reason) {
      await this.recordFailedMutationUnlocked(mutation, reason);
      throw reason;
    }
  }

  private async replayPendingMutationsUnlocked(): Promise<void> {
    const pending = await this.index.mutations.orderBy("enqueuedAt").toArray();
    for (const mutation of pending) {
      try {
        if (mutation.kind === "write")
          await this.applyWriteMutationUnlocked(mutation);
        else if (mutation.kind === "move")
          await this.applyMoveMutationUnlocked(mutation);
        else await this.applyDeleteMutationUnlocked(mutation);
      } catch (reason) {
        await this.recordFailedMutationUnlocked(mutation, reason);
      }
    }
  }

  private async recordFailedMutationUnlocked(
    mutation: PendingLocalMutation,
    reason: unknown,
  ): Promise<void> {
    await this.index.transaction("rw", this.index.mutations, async () => {
      const current = await this.index.mutations.get(mutation.taskId);
      if (current?.operationId === mutation.operationId)
        await this.index.mutations.put(recordMutationFailure(mutation, reason));
    });
  }

  private async applyWriteMutationUnlocked(
    mutation: Extract<PendingLocalMutation, { kind: "write" }>,
  ): Promise<void> {
    const source = await this.collection.write(mutation.task);
    const indexed = indexTask(mutation.task, source);
    await this.index.transaction(
      "rw",
      this.index.tasks,
      this.index.mutations,
      async () => {
        await this.index.tasks.put(indexed);
        await this.completeMutationUnlocked(mutation);
      },
    );
    this.cacheTask(indexed);
    this.markPathsChanged(mutation.task.path);
  }

  private async applyMoveMutationUnlocked(
    mutation: PendingTaskMove,
  ): Promise<Task> {
    const [sourceExists, destinationExists] = await Promise.all([
      this.collection.exists(mutation.from),
      this.collection.exists(mutation.to),
    ]);
    const moved = { ...mutation.task, path: mutation.to };
    if (!sourceExists && destinationExists) {
      const source = await this.collection.write(moved);
      await this.commitMovedTaskUnlocked(mutation, moved, source);
      return moved;
    }
    if (sourceExists && destinationExists && mutation.sourceWritten) {
      const source = await this.collection.write(moved);
      await this.collection.delete(mutation.from);
      await this.commitMovedTaskUnlocked(mutation, moved, source);
      return moved;
    }

    const written = await this.collection.write(mutation.task);
    const prepared = await this.markMoveSourceWrittenUnlocked(mutation);
    let source;
    try {
      source = await this.collection.rename(mutation.from, mutation.to);
    } catch (reason) {
      throw new LocalMoveFailure(reason, written);
    }
    await this.commitMovedTaskUnlocked(prepared, moved, source);
    return moved;
  }

  private async markMoveSourceWrittenUnlocked(
    mutation: PendingTaskMove,
  ): Promise<PendingTaskMove> {
    const prepared = { ...mutation, sourceWritten: true };
    await this.index.transaction("rw", this.index.mutations, async () => {
      const current = await this.index.mutations.get(mutation.taskId);
      if (current?.operationId === mutation.operationId)
        await this.index.mutations.put(prepared);
    });
    return prepared;
  }

  private async commitMovedTaskUnlocked(
    mutation: PendingTaskMove,
    moved: Task,
    source: { lastModified: number; size: number },
  ): Promise<void> {
    const indexed = indexTask(moved, source);
    await this.index.transaction(
      "rw",
      this.index.tasks,
      this.index.mutations,
      async () => {
        await this.index.tasks.put(indexed);
        await this.completeMutationUnlocked(mutation);
      },
    );
    this.cacheTask(indexed);
    this.markPathsChanged(mutation.from, mutation.to);
  }

  private async settleFailedMoveUnlocked(
    mutation: PendingTaskMove,
    source: { lastModified: number; size: number },
  ): Promise<void> {
    const indexed = indexTask(mutation.task, source);
    await this.index.transaction(
      "rw",
      this.index.tasks,
      this.index.mutations,
      async () => {
        await this.index.tasks.put(indexed);
        await this.completeMutationUnlocked(mutation);
      },
    );
    this.cacheTask(indexed);
    this.markPathsChanged(mutation.from);
  }

  private async applyDeleteMutationUnlocked(
    mutation: Extract<PendingLocalMutation, { kind: "delete" }>,
  ): Promise<void> {
    if (await this.collection.exists(mutation.path))
      await this.collection.delete(mutation.path);
    await this.index.transaction(
      "rw",
      this.index.tasks,
      this.index.mutations,
      async () => {
        await this.index.tasks.delete(mutation.taskId);
        await this.completeMutationUnlocked(mutation);
      },
    );
    this.removeCachedTask(mutation.taskId);
    this.markPathsChanged(mutation.path);
  }

  private async completeMutationUnlocked(
    mutation: PendingLocalMutation,
  ): Promise<void> {
    const current = await this.index.mutations.get(mutation.taskId);
    if (current?.operationId === mutation.operationId)
      await this.index.mutations.delete(mutation.taskId);
  }

  private cacheTask(task: IndexedTask): void {
    const current = this.cache.get(task.id);
    if (current) this.adjustStats(current, -1);
    this.cache.set(task.id, task);
    this.adjustStats(task, 1);
    if (task.recurrence && task.occurrenceMaterialization === "rolling")
      this.rollingParentIds.add(task.id);
    else this.rollingParentIds.delete(task.id);
  }

  private removeCachedTask(id: string): void {
    const current = this.cache.get(id);
    if (!current) return;
    this.cache.delete(id);
    this.rollingParentIds.delete(id);
    this.adjustStats(current, -1);
  }

  private adjustStats(task: Task, direction: 1 | -1): void {
    if (task.archived) this.cachedStats.archived += direction;
    else if (task.completed) this.cachedStats.completed += direction;
    else this.cachedStats.open += direction;
    this.cachedStats.total = this.cachedStats.open + this.cachedStats.completed;
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
    if (cached) this.cacheTask({ ...cached, ...stored });
    return stored;
  }

  private async maintainRollingOccurrencesUnlocked(): Promise<string[]> {
    const warnings: string[] = [];
    for (const id of this.rollingParentIds) {
      const parent = this.cache.get(id);
      if (!parent) continue;
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
    if (cached) this.cacheTask({ ...cached, ...retained });
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

class LocalMoveFailure extends Error {
  readonly source: { lastModified: number; size: number };

  constructor(reason: unknown, source: { lastModified: number; size: number }) {
    super(errorMessage(reason), { cause: reason });
    this.name = "LocalMoveFailure";
    this.source = source;
  }
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function selectFirstTasks(
  tasks: Iterable<IndexedTask>,
  matches: (task: IndexedTask) => boolean,
  limit: number,
): IndexedTask[] {
  if (!Number.isFinite(limit) || limit === Number.MAX_SAFE_INTEGER)
    return [...tasks].filter(matches).sort(compareTasks);

  const selected: IndexedTask[] = [];
  for (const task of tasks) {
    if (!matches(task)) continue;
    if (selected.length < limit) {
      heapPushWorst(selected, task);
      continue;
    }
    if (compareTasks(task, selected[0]) >= 0) continue;
    selected[0] = task;
    heapifyWorst(selected, 0);
  }
  return selected.sort(compareTasks);
}

function heapPushWorst(heap: IndexedTask[], task: IndexedTask): void {
  heap.push(task);
  let child = heap.length - 1;
  while (child > 0) {
    const parent = Math.floor((child - 1) / 2);
    if (compareTasks(heap[child], heap[parent]) <= 0) break;
    [heap[parent], heap[child]] = [heap[child], heap[parent]];
    child = parent;
  }
}

function heapifyWorst(heap: IndexedTask[], start: number): void {
  let parent = start;
  while (true) {
    const left = parent * 2 + 1;
    const right = left + 1;
    let worst = parent;
    if (left < heap.length && compareTasks(heap[left], heap[worst]) > 0)
      worst = left;
    if (right < heap.length && compareTasks(heap[right], heap[worst]) > 0)
      worst = right;
    if (worst === parent) return;
    [heap[parent], heap[worst]] = [heap[worst], heap[parent]];
    parent = worst;
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

export function matchesArchiveFilter(
  task: Task,
  query: TaskListQuery,
): boolean {
  const filter = query.archived ?? "exclude";
  return (
    filter === "include" || (filter === "only" ? task.archived : !task.archived)
  );
}

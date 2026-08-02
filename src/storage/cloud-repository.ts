import { Capacitor } from "@capacitor/core";
import { serializeMarkdownDocument } from "@tasknotes/model/frontmatter";
import {
  unwrapConnectOutcome,
  type ConnectOutcome,
  type MdbaseConnection,
  type MdbaseSyncTransport,
} from "@mdbase-dev/connect";
import type {
  JsonObject,
  MdbaseOperationEnvelope,
  SyncFileSnapshotPage,
  SyncCollectionResources,
  SyncMutationReceipt,
  SyncRecord,
} from "@mdbase-dev/connect-protocol";
import {
  IndexedDbReplicaStore,
  OfflineReplica,
  SyncError,
} from "@mdbase-dev/connect-sync";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { archiveMoveWarning } from "../domain/task-archive";
import {
  findOccurrenceParent,
  findMaterializedOccurrenceTask,
  occurrenceRecordId,
  rollingOccurrenceDates,
} from "../domain/task-occurrence";
import { runMdbaseMutation } from "./mdbase-mutation-coordinator";
import { MdbaseCollectionFileStore } from "./mdbase-files";
import { LocalFirstMdbaseFileStore } from "./local-first-mdbase-files";
import {
  connectedTaskRelationships,
  connectedTaskSignature as signature,
  connectedTaskStats,
  connectedViewExecutionKey as viewExecutionKey,
  listConnectedTasks,
  readOnlyTaskModelSettingsAccess,
  readOnlyTaskModelSettingsError,
} from "./connected-task-cache";
import { resolveTaskCollection } from "./tasknotes-collection";
import { TaskViewCache } from "./view-cache";
import { completeRecords, completeTaskValues } from "./completions";
import {
  normalizeViewDocuments,
  normalizeViewExecution,
  type ProviderViewExecution,
  type ProviderViewList,
} from "./views";

import type {
  CreateTaskInput,
  MaterializeOccurrenceResult,
  Task,
  TaskListQuery,
  TaskStats,
  TaskTimeEntry,
  UpdateTaskInput,
} from "../domain/task";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type {
  CollectionRecord,
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
import type {
  CollectionInfo,
  RefreshResult,
  RepositorySyncIssue,
  RepositorySyncStatus,
  TaskRepository,
} from "../application/ports/task-repository";

type CloudFrontmatter = JsonObject;

interface CachedCloudTask {
  task: Task;
  recordId: string;
  model: TaskNotesTaskModel;
  typeName: string;
}

export class CloudTaskRepository implements TaskRepository {
  readonly files: LocalFirstMdbaseFileStore;
  private replica: OfflineReplica<CloudFrontmatter> | null = null;
  private model = new TaskNotesTaskModel();
  private resources: SyncCollectionResources | null = null;
  private taskTypeName = "task";
  private taskProviders = new Map<string, TaskNotesTaskModel>([
    ["task", this.model],
  ]);
  private readonly cache = new Map<string, CachedCloudTask>();
  private completionRecords: CollectionRecord[] = [];
  private viewCache: TaskViewDocument[] = [];
  private readonly viewExecutionCache = new Map<string, TaskViewExecution>();
  private readonly viewExecutionInFlight = new Map<
    string,
    Promise<TaskViewExecution>
  >();
  private viewStore: TaskViewCache | null = null;
  private collectionId = "";
  private readonly listeners = new Set<() => void>();
  private readonly writeTails = new Map<string, Promise<void>>();
  private status: RepositorySyncStatus = {
    mode: "replicated",
    state: "syncing",
    pending: 0,
    issues: 0,
  };
  private initialization: Promise<void> | null = null;
  private syncInFlight: Promise<RefreshResult> | null = null;

  constructor(private readonly connect: MdbaseConnection<CloudFrontmatter>) {
    this.files = new LocalFirstMdbaseFileStore(
      new MdbaseCollectionFileStore(connect),
      connect.collectionId,
    );
  }

  initialize(): Promise<void> {
    this.initialization ??= this.initializeUnlocked();
    return this.initialization;
  }

  private async initializeUnlocked(): Promise<void> {
    await this.files.sync().catch(() => undefined);
    const sync = this.connect.sync();
    if (!sync) {
      throw new Error(
        "Connect an mdbase collection with sync access to continue.",
      );
    }
    this.collectionId = sync.collectionId;
    this.viewStore = new TaskViewCache(sync.collectionId);
    this.viewCache = await this.viewStore.readViewDocuments().catch(() => []);
    const store = new IndexedDbReplicaStore<CloudFrontmatter>(
      `tasknotes:${sync.collectionId}:${sync.replicaId}`,
      {
        replicaId: sync.replicaId,
        records: {},
        pending: [],
        conflicts: {},
      },
    );
    this.replica = new OfflineReplica(
      recordSyncTransport(sync.transport),
      store,
    );
    const cachedResources = await this.replica.collectionResources();
    if (cachedResources) {
      this.configureModel(cachedResources);
      await this.reloadCache();
      await this.maintainRollingOccurrencesUnlocked();
      await this.updateStatusCounts();
      this.emit();
      return;
    }
    try {
      await this.replica.initialize();
      this.status = {
        mode: "replicated",
        state: "synced",
        pending: 0,
        issues: 0,
        lastSyncedAt: new Date().toISOString(),
      };
    } catch (reason) {
      throw cloudFirstOpenError(reason);
    }
    const resources = await this.requireReplica().collectionResources();
    if (!resources)
      throw new Error(
        "The cloud collection has no cached TaskNotes definition.",
      );
    this.configureModel(resources);
    await this.reloadCache();
    const rollingCreated = await this.maintainRollingOccurrencesUnlocked();
    if (rollingCreated) {
      try {
        await this.requireReplica().sync();
        await this.reloadResources();
        await this.reloadCache();
      } catch (reason) {
        this.setOffline(reason);
      }
    }
    await this.updateStatusCounts();
    this.emit();
  }

  refresh(): Promise<RefreshResult> {
    if (this.syncInFlight) return this.syncInFlight;
    const run = this.syncUnlocked().finally(() => {
      this.syncInFlight = null;
    });
    this.syncInFlight = run;
    return run;
  }

  private async syncUnlocked(): Promise<RefreshResult> {
    const replica = this.requireReplica();
    const startedAt = performance.now();
    const before = new Map(
      [...this.cache.values()].map(({ task }) => [task.id, signature(task)]),
    );
    this.status = { ...this.status, state: "syncing" };
    this.emit();
    try {
      await replica.sync();
      await this.reloadResources();
      await this.reloadCache();
      if (await this.maintainRollingOccurrencesUnlocked()) {
        await replica.sync();
        await this.reloadResources();
        await this.reloadCache();
      }
      await this.updateStatusCounts();
      this.status = {
        ...this.status,
        state: this.status.issues ? "issues" : "synced",
        lastSyncedAt: new Date().toISOString(),
        message: undefined,
      };
    } catch (reason) {
      await this.reloadCache();
      await this.maintainRollingOccurrencesUnlocked();
      await this.updateStatusCounts();
      this.setOffline(reason);
    }
    this.emit();
    let changed = 0;
    for (const { task } of this.cache.values()) {
      if (before.get(task.id) !== signature(task)) changed += 1;
    }
    const removed = [...before.keys()].filter(
      (id) => !this.cache.has(id),
    ).length;
    return {
      scanned: this.cache.size,
      changed,
      removed,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  }

  async list(query: TaskListQuery = {}): Promise<Task[]> {
    return listConnectedTasks(this.cache.values(), query);
  }

  async get(id: string): Promise<Task | null> {
    return this.cache.get(id)?.task ?? null;
  }

  async relationships(id: string) {
    return connectedTaskRelationships(this.cache.values(), id);
  }

  async completeField(
    request: FieldCompletionRequest,
  ): Promise<FieldCompletion[]> {
    if (request.kind === "values")
      return completeTaskValues(
        [...this.cache.values()].map(({ task }) => task),
        request,
      );
    return completeRecords(
      this.completionRecords,
      request,
      this.model.configuration().linkWriteFormat,
    );
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const id = crypto.randomUUID();
    const created = await this.model.createWithTemplate(
      input,
      { id, now: new Date().toISOString() },
      (path) => this.loadTemplate(path),
    );
    const task = await this.withAvailableTaskPath(created);
    const record = await this.requireReplica().queueCreate({
      recordId: id,
      path: task.path,
      frontmatter: asJson(task.frontmatter),
      body: task.body,
      types: [this.taskTypeName],
    });
    this.cache.set(task.id, {
      task,
      recordId: record.record_id,
      model: this.model,
      typeName: this.taskTypeName,
    });
    const retained = await this.withRollingWarnings(task);
    await this.afterLocalMutation();
    return retained;
  }

  update(id: string, input: UpdateTaskInput): Promise<Task> {
    return this.serializeWrite(id, async () => {
      const current = this.requireTask(id);
      const next = current.model.update(current.task, input, {
        now: new Date().toISOString(),
      });
      await this.requireReplica().queueUpdate({
        recordId: current.recordId,
        patch: frontmatterPatch(current.task.frontmatter, next.frontmatter),
        body: next.body,
      });
      this.cache.set(id, { ...current, task: next });
      const retained = await this.withRollingWarnings(next);
      await this.afterLocalMutation();
      return retained;
    });
  }

  async updateMany(
    updates: readonly { id: string; input: UpdateTaskInput }[],
  ): Promise<Task[]> {
    const tasks: Task[] = [];
    for (const { id, input } of updates)
      tasks.push(await this.update(id, input));
    return tasks;
  }

  toggle(id: string, occurrenceDate?: string): Promise<Task> {
    const cached = this.cache.get(id)?.task;
    if (cached?.recurrenceParent && cached.occurrenceDate) {
      const parent = findOccurrenceParent(
        [...this.cache.values()].map(({ task }) => task),
        cached,
      );
      if (!parent)
        return Promise.reject(
          new Error(
            "invalid_recurrence_parent: The occurrence parent could not be resolved.",
          ),
        );
      return this.serializeWrites([id, parent.id], () =>
        this.transitionMaterializedUnlocked(id, parent.id, "toggle"),
      );
    }
    return this.serializeWrite(id, async () => {
      const current = this.requireTask(id);
      const next = current.model.toggle(current.task, {
        now: new Date().toISOString(),
        currentDate: occurrenceDate,
      });
      await this.requireReplica().queueUpdate({
        recordId: current.recordId,
        patch: frontmatterPatch(current.task.frontmatter, next.frontmatter),
        body: next.body,
      });
      this.cache.set(id, { ...current, task: next });
      await this.afterLocalMutation();
      return next;
    });
  }

  skip(id: string, occurrenceDate: string): Promise<Task> {
    const cached = this.cache.get(id)?.task;
    if (cached?.recurrenceParent && cached.occurrenceDate) {
      const parent = findOccurrenceParent(
        [...this.cache.values()].map(({ task }) => task),
        cached,
      );
      if (!parent)
        return Promise.reject(
          new Error(
            "invalid_recurrence_parent: The occurrence parent could not be resolved.",
          ),
        );
      return this.serializeWrites([id, parent.id], () =>
        this.transitionMaterializedUnlocked(id, parent.id, "skip"),
      );
    }
    return this.serializeWrite(id, async () => {
      const current = this.requireTask(id);
      const next = current.model.skip(current.task, {
        now: new Date().toISOString(),
        currentDate: occurrenceDate,
      });
      await this.requireReplica().queueUpdate({
        recordId: current.recordId,
        patch: frontmatterPatch(current.task.frontmatter, next.frontmatter),
        body: next.body,
      });
      this.cache.set(id, { ...current, task: next });
      await this.afterLocalMutation();
      return next;
    });
  }

  materializeOccurrence(
    parentId: string,
    occurrenceDate: string,
  ): Promise<MaterializeOccurrenceResult> {
    return this.serializeWrite(parentId, () =>
      this.materializeOccurrenceUnlocked(parentId, occurrenceDate),
    );
  }

  async startTimeTracking(id: string, description?: string): Promise<Task> {
    return this.persistModelMutation(id, (task, model) =>
      model.startTimeTracking(task, {
        now: new Date().toISOString(),
        description,
      }),
    );
  }

  async stopTimeTracking(id: string): Promise<Task> {
    return this.persistModelMutation(id, (task, model) =>
      model.stopTimeTracking(task, { now: new Date().toISOString() }),
    );
  }

  async replaceTimeEntries(
    id: string,
    entries: TaskTimeEntry[],
  ): Promise<Task> {
    return this.persistModelMutation(id, (task, model) =>
      model.replaceTimeEntries(task, entries, {
        now: new Date().toISOString(),
      }),
    );
  }

  async removeTimeEntry(id: string, index: number): Promise<Task> {
    return this.persistModelMutation(id, (task, model) =>
      model.removeTimeEntry(task, index, {
        now: new Date().toISOString(),
      }),
    );
  }

  setArchived(id: string, archived: boolean): Promise<Task> {
    return this.serializeWrite(id, async () => {
      const current = this.requireTask(id);
      const next = current.model.update(
        current.task,
        { archived },
        { now: new Date().toISOString() },
      );
      await this.requireReplica().queueUpdate({
        recordId: current.recordId,
        patch: frontmatterPatch(current.task.frontmatter, next.frontmatter),
        body: next.body,
      });
      let stored = next;
      const destination = current.model.archiveDestination(next, archived);
      if (destination) {
        try {
          await this.requireReplica().queueRename({
            recordId: current.recordId,
            path: destination,
          });
          stored = { ...next, path: destination };
        } catch (reason) {
          stored = {
            ...next,
            operationWarnings: [archiveMoveWarning(reason, archived)],
          };
        }
      }
      this.cache.set(id, { ...current, task: stored });
      await this.afterLocalMutation();
      return stored;
    });
  }

  delete(id: string): Promise<void> {
    return this.serializeWrite(id, async () => {
      const current = this.cache.get(id);
      if (!current) return;
      await this.requireReplica().queueDelete({ recordId: current.recordId });
      this.cache.delete(id);
      await this.afterLocalMutation();
    });
  }

  async stats(): Promise<TaskStats> {
    return connectedTaskStats(this.cache.values());
  }

  async taskConfiguration(): Promise<TaskCollectionConfiguration> {
    return this.model.configuration();
  }

  async taskModelSettingsAccess() {
    return readOnlyTaskModelSettingsAccess(this.taskTypeName);
  }

  async updateTaskModelSettings(): Promise<TaskCollectionConfiguration> {
    throw readOnlyTaskModelSettingsError();
  }

  async listViews(): Promise<TaskViewDocument[]> {
    try {
      this.viewCache = normalizeViewDocuments(
        validResult(await this.connect.listViews()) as ProviderViewList,
      );
      await this.viewStore
        ?.writeViewDocuments(this.viewCache)
        .catch(() => undefined);
      return structuredClone(this.viewCache);
    } catch (reason) {
      if (this.viewCache.length) return structuredClone(this.viewCache);
      throw reason;
    }
  }

  async cachedViews(): Promise<TaskViewDocument[]> {
    return structuredClone(this.viewCache);
  }

  async cachedViewExecution(view: TaskView): Promise<TaskViewExecution | null> {
    const key = viewExecutionKey(view);
    const cached =
      this.viewExecutionCache.get(key) ??
      (await this.viewStore?.readExecution(view).catch(() => null));
    if (!cached) return null;
    this.viewExecutionCache.set(key, cached);
    return structuredClone(cached);
  }

  async executeView(view: TaskView): Promise<TaskViewExecution> {
    const key = viewExecutionKey(view);
    const pending = this.viewExecutionInFlight.get(key);
    if (pending) return pending;
    const execution = this.executeViewUnlocked(view).finally(() => {
      if (this.viewExecutionInFlight.get(key) === execution)
        this.viewExecutionInFlight.delete(key);
    });
    this.viewExecutionInFlight.set(key, execution);
    return execution;
  }

  private async executeViewUnlocked(
    view: TaskView,
  ): Promise<TaskViewExecution> {
    try {
      const result = validResult(
        await this.connect.executeView({
          path: view.source.path,
          view: view.id,
          limit: 2_000,
          render: false,
        }),
      ) as ProviderViewExecution;
      const execution = normalizeViewExecution(view, result, (record) => {
        const provider = this.providerForTypes(record.types ?? []);
        if (!provider) return null;
        try {
          return provider.model.read({
            path: record.path,
            frontmatter: record.effective_frontmatter,
            body: record.body ?? "",
          });
        } catch {
          return null;
        }
      });
      this.viewExecutionCache.set(viewExecutionKey(view), execution);
      await this.viewStore?.writeExecution(execution).catch(() => undefined);
      return execution;
    } catch (reason) {
      const cached = await this.cachedViewExecution(view);
      if (cached) return { ...structuredClone(cached), stale: true };
      throw reason;
    }
  }

  async readViewSource(path: string): Promise<TaskViewSourceDocument> {
    return validResult(await this.connect.readViewSource({ path }));
  }

  async createViewSource(
    input: CreateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument> {
    return runMdbaseMutation(this.connect, async () => {
      const created = validResult(
        await this.connect.createViewSource({ ...input }),
      );
      this.invalidateViewsAfterMutation();
      return created;
    });
  }

  async updateViewSource(
    input: UpdateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument> {
    const operationInput = {
      path: input.path,
      document: input.document,
      if_revision: input.ifRevision,
    };
    return runMdbaseMutation(this.connect, async () => {
      const updated = validResult(
        await this.connect.updateViewSource(operationInput),
      );
      this.invalidateViewsAfterMutation();
      return updated;
    });
  }

  async deleteViewSource(path: string, ifRevision?: string): Promise<void> {
    const operationInput = { path, if_revision: ifRevision };
    await runMdbaseMutation(this.connect, async () => {
      validResult(await this.connect.deleteViewSource(operationInput));
      this.invalidateViewsAfterMutation();
    });
  }

  private invalidateViewsAfterMutation(): void {
    this.viewExecutionCache.clear();
  }

  async collectionInfo(): Promise<CollectionInfo> {
    return {
      kind: "connect",
      id: this.collectionId,
      name: "mdbase cloud",
      location: "Offline copy on this device",
      runtime: Capacitor.isNativePlatform() ? "native" : "browser",
    };
  }

  async syncStatus(): Promise<RepositorySyncStatus> {
    await this.updateStatusCounts();
    return { ...this.status };
  }

  async syncIssues(): Promise<RepositorySyncIssue[]> {
    return (await this.requireReplica().conflictEntries()).map(
      ({ recordId, receipt }) => this.toIssue(recordId, receipt),
    );
  }

  async resolveSyncIssue(
    id: string,
    resolution: "local" | "remote",
  ): Promise<void> {
    await this.requireReplica().resolveConflict(id, resolution);
    await this.reloadCache();
    await this.updateStatusCounts();
    this.emit();
    void this.refresh();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private configureModel(resources: SyncCollectionResources): void {
    const resolved = resolveTaskCollection(resources);
    this.resources = structuredClone(resources);
    this.taskTypeName = resolved.typeName;
    this.model = resolved.model;
    this.taskProviders = new Map(
      resolved.providers.map((provider) => [provider.typeName, provider.model]),
    );
  }

  private async reloadResources(): Promise<void> {
    const resources = await this.requireReplica().collectionResources();
    if (!resources)
      throw new Error("The cloud collection has no TaskNotes definition.");
    this.configureModel(resources);
  }

  private async loadTemplate(path: string): Promise<string> {
    const resource = this.resources?.documents?.find(
      (document) => document.path === path,
    );
    if (resource) return resource.document;
    const record = (await this.requireReplica().records()).find(
      (candidate) => candidate.path === path,
    );
    if (!record)
      throw new Error(
        `template_missing: The template ${path} is not available offline.`,
      );
    return serializeMarkdownDocument(record.frontmatter, record.body);
  }

  private async reloadCache(): Promise<void> {
    const next = new Map<string, CachedCloudTask>();
    const records = await this.requireReplica().records();
    this.completionRecords = records.map(cloudCollectionRecord);
    for (const record of records) {
      const decoded = this.readRecord(record);
      if (decoded)
        next.set(decoded.task.id, {
          ...decoded,
          recordId: record.record_id,
        });
    }
    this.cache.clear();
    for (const [id, value] of next) this.cache.set(id, value);
  }

  private readRecord(
    record: SyncRecord<CloudFrontmatter>,
  ): Omit<CachedCloudTask, "recordId"> | null {
    const provider = this.providerForTypes(record.types);
    if (!provider) return null;
    try {
      return {
        task: provider.model.read({
          path: record.path,
          frontmatter: record.frontmatter,
          body: record.body,
        }),
        ...provider,
      };
    } catch {
      return null;
    }
  }

  private providerForTypes(
    types: string[],
  ): { model: TaskNotesTaskModel; typeName: string } | null {
    const matches = types
      .map((typeName) => {
        const model = this.taskProviders.get(typeName);
        return model ? { model, typeName } : null;
      })
      .filter(
        (
          provider,
        ): provider is { model: TaskNotesTaskModel; typeName: string } =>
          provider !== null,
      );
    return matches.length === 1 ? matches[0] : null;
  }

  private async afterLocalMutation(): Promise<void> {
    await this.updateStatusCounts();
    this.emit();
    void this.refresh();
  }

  private persistModelMutation(
    id: string,
    mutate: (task: Task, model: TaskNotesTaskModel) => Task,
  ): Promise<Task> {
    return this.serializeWrite(id, async () => {
      const current = this.requireTask(id);
      const next = mutate(current.task, current.model);
      await this.requireReplica().queueUpdate({
        recordId: current.recordId,
        patch: frontmatterPatch(current.task.frontmatter, next.frontmatter),
        body: next.body,
      });
      this.cache.set(id, { ...current, task: next });
      await this.afterLocalMutation();
      return next;
    });
  }

  private async materializeOccurrenceUnlocked(
    parentId: string,
    occurrenceDate: string,
    notify = true,
  ): Promise<MaterializeOccurrenceResult> {
    const parent = this.requireTask(parentId);
    const occurrences = [...this.cache.values()]
      .map(({ task }) => task)
      .filter((task) => task.recurrenceParent && task.occurrenceDate);
    const resolved = findMaterializedOccurrenceTask(
      [...this.cache.values()].map(({ task }) => task),
      parent.task,
      occurrenceDate,
    );
    if (resolved) return { task: resolved, created: false, warnings: [] };
    const result = await parent.model.materializeOccurrence(
      parent.task,
      occurrenceDate,
      occurrences,
      {
        id: await occurrenceRecordId(parent.task.id, occurrenceDate),
        now: new Date().toISOString(),
      },
      (path) => this.loadTemplate(path),
    );
    if (!result.created) return result;
    const created = await this.withAvailableTaskPath(result.task);
    const record = await this.requireReplica().queueCreate({
      recordId: created.id,
      path: created.path,
      frontmatter: asJson(created.frontmatter),
      body: created.body,
      types: [parent.typeName],
    });
    const task = result.warnings.length
      ? { ...created, operationWarnings: result.warnings }
      : created;
    this.cache.set(task.id, {
      task,
      recordId: record.record_id,
      model: parent.model,
      typeName: parent.typeName,
    });
    if (notify) await this.afterLocalMutation();
    return { ...result, task };
  }

  private async withAvailableTaskPath(task: Task): Promise<Task> {
    const records = await this.requireReplica().records();
    const occupied = new Set([
      ...records.map((record) => record.path),
      ...[...this.cache.values()].map(({ task: cached }) => cached.path),
    ]);
    if (!occupied.has(task.path)) return task;
    const extension = /\.md$/i.test(task.path) ? ".md" : "";
    const stem = extension ? task.path.slice(0, -extension.length) : task.path;
    const shortId = task.id.replaceAll("-", "").slice(0, 8);
    const candidate = `${stem}-${shortId}${extension}`;
    if (!occupied.has(candidate)) return { ...task, path: candidate };
    return { ...task, path: `${stem}-${task.id}${extension}` };
  }

  private async transitionMaterializedUnlocked(
    occurrenceId: string,
    parentId: string,
    action: "toggle" | "skip",
  ): Promise<Task> {
    const occurrence = this.requireTask(occurrenceId);
    const parent = this.requireTask(parentId);
    if (occurrence.typeName !== parent.typeName)
      throw new Error(
        "A materialized occurrence and its parent must use the same TaskNotes implementation type.",
      );
    const transition = parent.model.transitionMaterializedOccurrence(
      occurrence.task,
      parent.task,
      action,
      { now: new Date().toISOString() },
    );
    await this.requireReplica().queueUpdate({
      recordId: occurrence.recordId,
      patch: frontmatterPatch(
        occurrence.task.frontmatter,
        transition.occurrence.frontmatter,
      ),
      body: transition.occurrence.body,
    });
    this.cache.set(occurrenceId, {
      ...occurrence,
      task: transition.occurrence,
    });
    const warnings: string[] = [];
    try {
      await this.requireReplica().queueUpdate({
        recordId: parent.recordId,
        patch: frontmatterPatch(
          parent.task.frontmatter,
          transition.parent.frontmatter,
        ),
        body: transition.parent.body,
      });
      this.cache.set(parentId, { ...parent, task: transition.parent });
    } catch (reason) {
      warnings.push(
        `occurrence_parent_reconciliation_failed: ${errorMessage(reason)}`,
      );
    }
    if (transition.materializeNextDate) {
      try {
        await this.materializeOccurrenceUnlocked(
          parentId,
          transition.materializeNextDate,
          false,
        );
      } catch (reason) {
        warnings.push(
          `next_occurrence_materialization_failed: ${errorMessage(reason)}`,
        );
      }
    }
    let task = transition.occurrence;
    if (warnings.length) {
      task = { ...task, operationWarnings: warnings };
      this.cache.set(occurrenceId, { ...occurrence, task });
    }
    await this.afterLocalMutation();
    return task;
  }

  private async withRollingWarnings(task: Task): Promise<Task> {
    if (!task.recurrence || task.occurrenceMaterialization !== "rolling")
      return task;
    const { warnings } = await this.materializeRollingWindow(task);
    if (!warnings.length) return task;
    const retained = { ...task, operationWarnings: warnings };
    const cached = this.cache.get(task.id);
    if (cached) this.cache.set(task.id, { ...cached, task: retained });
    this.emit();
    return retained;
  }

  private async maintainRollingOccurrencesUnlocked(): Promise<number> {
    let created = 0;
    const parents = [...this.cache.values()]
      .map(({ task }) => task)
      .filter(
        (task) =>
          task.recurrence && task.occurrenceMaterialization === "rolling",
      );
    for (const parent of parents) {
      const result = await this.materializeRollingWindow(parent);
      created += result.created;
      const { warnings } = result;
      if (!warnings.length) continue;
      const cached = this.cache.get(parent.id);
      if (cached)
        this.cache.set(parent.id, {
          ...cached,
          task: { ...cached.task, operationWarnings: warnings },
        });
    }
    return created;
  }

  private async materializeRollingWindow(
    task: Task,
  ): Promise<{ warnings: string[]; created: number }> {
    let dates: string[];
    try {
      dates = rollingOccurrenceDates(task);
    } catch (reason) {
      return {
        warnings: [
          `rolling_occurrence_materialization_failed: ${errorMessage(reason)}`,
        ],
        created: 0,
      };
    }
    const warnings: string[] = [];
    let created = 0;
    for (const date of dates) {
      try {
        const result = await this.materializeOccurrenceUnlocked(
          task.id,
          date,
          false,
        );
        if (result.created) created += 1;
      } catch (reason) {
        warnings.push(
          `rolling_occurrence_materialization_failed: ${date}: ${errorMessage(reason)}`,
        );
      }
    }
    return { warnings, created };
  }

  private serializeWrite<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.serializeWrites([key], operation);
  }

  private serializeWrites<T>(
    keys: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T> {
    const unique = [...new Set(keys)].sort();
    const previous = Promise.all(
      unique.map((key) =>
        (this.writeTails.get(key) ?? Promise.resolve()).catch(() => undefined),
      ),
    );
    const result = previous.then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    for (const key of unique) this.writeTails.set(key, tail);
    void tail.finally(() => {
      for (const key of unique)
        if (this.writeTails.get(key) === tail) this.writeTails.delete(key);
    });
    return result;
  }

  private async updateStatusCounts(): Promise<void> {
    if (!this.replica) return;
    const [pending, issues] = await Promise.all([
      this.replica.pending(),
      this.replica.conflicts(),
    ]);
    this.status = {
      ...this.status,
      pending: pending.length,
      issues: issues.length,
      state: issues.length ? "issues" : this.status.state,
    };
  }

  private setOffline(reason: unknown): void {
    this.status = {
      ...this.status,
      state: "offline",
      message: cloudErrorMessage(reason),
    };
  }

  private toIssue(
    recordId: string,
    receipt: SyncMutationReceipt<CloudFrontmatter>,
  ): RepositorySyncIssue {
    const local = [...this.cache.values()].find(
      (candidate) => candidate.recordId === recordId,
    );
    const remote =
      receipt.status === "conflicted" ? receipt.conflict.current : undefined;
    return {
      id: recordId,
      path: local?.task.path ?? remote?.path,
      title:
        local?.task.title ??
        (typeof remote?.frontmatter.title === "string"
          ? remote.frontmatter.title
          : (remote?.path ?? "Sync issue")),
      message:
        receipt.status === "rejected"
          ? receipt.error.message
          : "This task changed on another device while you were editing it.",
      canKeepLocal: receipt.status === "conflicted" && Boolean(remote),
    };
  }

  private requireReplica(): OfflineReplica<CloudFrontmatter> {
    if (!this.replica) throw new Error("The cloud collection is not open.");
    return this.replica;
  }

  private requireTask(id: string): CachedCloudTask {
    const task = this.cache.get(id);
    if (!task) throw new Error("Task not found.");
    return task;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function cloudCollectionRecord(
  record: SyncRecord<CloudFrontmatter>,
): CollectionRecord {
  return {
    path: record.path,
    label:
      typeof record.frontmatter.title === "string"
        ? record.frontmatter.title
        : (record.path.split("/").at(-1)?.replace(/\.md$/i, "") ?? record.path),
    frontmatter: record.frontmatter,
    body: record.body,
    types: record.types,
  };
}

function frontmatterPatch(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): JsonObject {
  const patch: JsonObject = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!(key in after)) patch[key] = null;
    else if (!sameValue(before[key], after[key]))
      patch[key] = structuredClone(after[key]) as JsonObject[string];
  }
  return patch;
}

function asJson(value: Record<string, unknown>): CloudFrontmatter {
  return structuredClone(value) as CloudFrontmatter;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function cloudFirstOpenError(reason: unknown): Error {
  const detail = cloudErrorMessage(reason);
  if (isConnectionFailure(reason))
    return new Error(
      `The cloud collection needs a connection the first time it opens. ${detail}`,
    );
  return new Error(`The cloud collection could not be opened. ${detail}`);
}

function isConnectionFailure(reason: unknown): boolean {
  if (
    reason instanceof TypeError &&
    /(failed to fetch|load failed|network\s*error)/i.test(reason.message)
  )
    return true;
  return (
    reason instanceof SyncError &&
    ["offline", "connector_offline", "provider_offline"].includes(reason.code)
  );
}

function cloudErrorMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message) return reason.message;
  return "The collection returned an unknown error.";
}

function validResult<Result>(
  envelope: ConnectOutcome<Result> | MdbaseOperationEnvelope<Result>,
): Result {
  if ("ok" in envelope) return unwrapConnectOutcome(envelope);
  if (!envelope.valid)
    throw new Error(
      envelope.diagnostics.map((item) => item.message).join(" ") ||
        "The collection rejected this view.",
    );
  return envelope.result;
}

/**
 * The Connect SDK's sync facade is record-only in beta.23, while connect-sync
 * now requires the binary plane on every transport. OfflineReplica does not
 * consume that plane, so provide an empty, boundary-correct file snapshot.
 */
function recordSyncTransport<Frontmatter extends JsonObject>(
  transport: MdbaseSyncTransport<Frontmatter>,
) {
  let session: Awaited<ReturnType<typeof transport.openSession>> | null = null;
  return {
    openSession: async () => {
      session = await transport.openSession();
      return session;
    },
    snapshot: (snapshotId: string, page?: string) =>
      transport.snapshot(snapshotId, page),
    changes: (after: number, limit?: number) => transport.changes(after, limit),
    mutate: (mutation: Parameters<typeof transport.mutate>[0]) =>
      transport.mutate(mutation),
    fileSnapshot: async (snapshotId: string): Promise<SyncFileSnapshotPage> => {
      if (!session || session.snapshot_id !== snapshotId)
        throw new SyncError(
          "invalid_snapshot",
          "The record-only sync adapter has no matching session.",
        );
      return {
        protocol_version: 1,
        type: "file_snapshot_page",
        snapshot_id: snapshotId,
        scope_epoch: session.scope_epoch,
        cursor: session.head,
        files: [],
      };
    },
    downloadFile: (): AsyncIterable<Uint8Array> => {
      throw new SyncError(
        "unsupported_operation",
        "The Connect SDK record-sync facade does not expose binary downloads.",
      );
    },
  };
}

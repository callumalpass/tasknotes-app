import { Capacitor } from "@capacitor/core";
import type { MdbaseConnect } from "@mdbase/connect";
import type {
  JsonObject,
  MdbaseOperationEnvelope,
  SyncCollectionResources,
  SyncMutationReceipt,
  SyncRecord,
} from "@mdbase/connect-protocol";
import {
  IndexedDbReplicaStore,
  OfflineReplica,
  SyncError,
} from "@mdbase/connect-sync";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { compareTasks } from "./repository";
import { resolveTaskCollection } from "./tasknotes-collection";
import { TaskViewCache } from "./view-cache";
import {
  flattenViews,
  normalizeViewExecution,
  type ProviderViewExecution,
  type ProviderViewList,
} from "./views";

import type {
  CreateTaskInput,
  Task,
  TaskListQuery,
  TaskStats,
  UpdateTaskInput,
} from "../domain/task";
import type { TaskView, TaskViewExecution } from "../domain/view";
import type {
  CollectionInfo,
  RefreshResult,
  RepositorySyncIssue,
  RepositorySyncStatus,
  TaskRepository,
} from "./repository";

type CloudFrontmatter = JsonObject;

interface CachedCloudTask {
  task: Task;
  recordId: string;
}

export class CloudTaskRepository implements TaskRepository {
  private replica: OfflineReplica<CloudFrontmatter> | null = null;
  private model = new TaskNotesTaskModel();
  private taskTypeName = "task";
  private readonly cache = new Map<string, CachedCloudTask>();
  private viewCache: TaskView[] = [];
  private readonly viewExecutionCache = new Map<string, TaskViewExecution>();
  private viewStore: TaskViewCache | null = null;
  private readonly listeners = new Set<() => void>();
  private status: RepositorySyncStatus = {
    mode: "replicated",
    state: "syncing",
    pending: 0,
    issues: 0,
  };
  private initialization: Promise<void> | null = null;
  private syncInFlight: Promise<RefreshResult> | null = null;

  constructor(private readonly connect: MdbaseConnect<CloudFrontmatter>) {}

  initialize(): Promise<void> {
    this.initialization ??= this.initializeUnlocked();
    return this.initialization;
  }

  private async initializeUnlocked(): Promise<void> {
    const hosted = this.connect.hostedSync();
    if (!hosted) {
      throw new Error("Connect an mdbase cloud collection to continue.");
    }
    this.viewStore = new TaskViewCache(hosted.collectionId);
    this.viewCache = await this.viewStore.readViews();
    const store = new IndexedDbReplicaStore<CloudFrontmatter>(
      `tasknotes:${hosted.collectionId}:${hosted.replicaId}`,
      {
        replicaId: hosted.replicaId,
        records: {},
        pending: [],
        conflicts: {},
      },
    );
    this.replica = new OfflineReplica(hosted.transport, store);
    const cachedResources = await this.replica.collectionResources();
    try {
      if (cachedResources) await this.replica.pull();
      else await this.replica.initialize();
      this.status = {
        mode: "replicated",
        state: "synced",
        pending: 0,
        issues: 0,
        lastSyncedAt: new Date().toISOString(),
      };
    } catch (reason) {
      if (!cachedResources || isNotInitialized(reason)) {
        try {
          await this.replica.initialize();
          this.status = {
            mode: "replicated",
            state: "synced",
            pending: 0,
            issues: 0,
            lastSyncedAt: new Date().toISOString(),
          };
        } catch (initialReason) {
          if (!cachedResources) throw cloudFirstOpenError(initialReason);
          this.setOffline(initialReason);
        }
      } else {
        this.setOffline(reason);
      }
    }
    const resources =
      (await this.requireReplica().collectionResources()) ?? cachedResources;
    if (!resources)
      throw new Error(
        "The cloud collection has no cached TaskNotes definition.",
      );
    this.configureModel(resources);
    await this.reloadCache();
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
      await this.reloadCache();
      await this.updateStatusCounts();
      this.status = {
        ...this.status,
        state: this.status.issues ? "issues" : "synced",
        lastSyncedAt: new Date().toISOString(),
        message: undefined,
      };
    } catch (reason) {
      await this.reloadCache();
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
    const tokens = (query.search ?? "")
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return [...this.cache.values()]
      .map(({ task }) => task)
      .filter((task) => {
        if (query.status === "completed" && !task.completed) return false;
        if (
          query.status !== "completed" &&
          query.status !== "all" &&
          task.completed
        )
          return false;
        const searchable = [
          task.title,
          task.body,
          ...task.tags,
          ...task.contexts,
          ...task.projects,
        ]
          .join("\n")
          .toLocaleLowerCase();
        return tokens.every((token) => searchable.includes(token));
      })
      .sort(compareTasks)
      .slice(0, query.limit ?? 500);
  }

  async get(id: string): Promise<Task | null> {
    return this.cache.get(id)?.task ?? null;
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const id = crypto.randomUUID();
    const task = this.model.create(input, {
      id,
      now: new Date().toISOString(),
    });
    const record = await this.requireReplica().queueCreate({
      recordId: id,
      path: task.path,
      frontmatter: asJson(task.frontmatter),
      body: task.body,
      types: [this.taskTypeName],
    });
    this.cache.set(task.id, { task, recordId: record.record_id });
    await this.afterLocalMutation();
    return task;
  }

  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    const current = this.requireTask(id);
    const next = this.model.update(current.task, input, {
      now: new Date().toISOString(),
    });
    await this.requireReplica().queueUpdate({
      recordId: current.recordId,
      patch: frontmatterPatch(current.task.frontmatter, next.frontmatter),
      body: next.body,
    });
    this.cache.set(id, { ...current, task: next });
    await this.afterLocalMutation();
    return next;
  }

  async toggle(id: string): Promise<Task> {
    const current = this.requireTask(id);
    const next = this.model.toggle(current.task, {
      now: new Date().toISOString(),
    });
    await this.requireReplica().queueUpdate({
      recordId: current.recordId,
      patch: frontmatterPatch(current.task.frontmatter, next.frontmatter),
      body: next.body,
    });
    this.cache.set(id, { ...current, task: next });
    await this.afterLocalMutation();
    return next;
  }

  async delete(id: string): Promise<void> {
    const current = this.cache.get(id);
    if (!current) return;
    await this.requireReplica().queueDelete({ recordId: current.recordId });
    this.cache.delete(id);
    await this.afterLocalMutation();
  }

  async stats(): Promise<TaskStats> {
    let completed = 0;
    for (const { task } of this.cache.values())
      if (task.completed) completed += 1;
    return {
      total: this.cache.size,
      open: this.cache.size - completed,
      completed,
    };
  }

  async listViews(): Promise<TaskView[]> {
    try {
      this.viewCache = flattenViews(
        validResult(await this.connect.listViews()) as ProviderViewList,
      );
      await this.viewStore?.writeViews(this.viewCache);
      return structuredClone(this.viewCache);
    } catch (reason) {
      if (this.viewCache.length) return structuredClone(this.viewCache);
      throw reason;
    }
  }

  async executeView(view: TaskView): Promise<TaskViewExecution> {
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
        try {
          return this.model.read({
            path: record.path,
            frontmatter: record.frontmatter ?? {},
            body: record.body ?? "",
          });
        } catch {
          return null;
        }
      });
      this.viewExecutionCache.set(view.key, execution);
      await this.viewStore?.writeExecution(execution);
      return execution;
    } catch (reason) {
      const cached =
        this.viewExecutionCache.get(view.key) ??
        (await this.viewStore?.readExecution(view.key));
      if (cached) return { ...structuredClone(cached), stale: true };
      throw reason;
    }
  }

  async collectionInfo(): Promise<CollectionInfo> {
    return {
      kind: "connect",
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
    this.taskTypeName = resolved.typeName;
    this.model = resolved.model;
  }

  private async reloadCache(): Promise<void> {
    const next = new Map<string, CachedCloudTask>();
    for (const record of await this.requireReplica().records()) {
      if (!record.types.includes(this.taskTypeName)) continue;
      const task = this.readRecord(record);
      if (task) next.set(task.id, { task, recordId: record.record_id });
    }
    this.cache.clear();
    for (const [id, value] of next) this.cache.set(id, value);
  }

  private readRecord(record: SyncRecord<CloudFrontmatter>): Task | null {
    try {
      return this.model.read({
        path: record.path,
        frontmatter: record.frontmatter,
        body: record.body,
      });
    } catch {
      return null;
    }
  }

  private async afterLocalMutation(): Promise<void> {
    await this.updateStatusCounts();
    this.emit();
    void this.refresh();
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

function signature(task: Task): string {
  return JSON.stringify([task.path, task.frontmatter, task.body]);
}

function isNotInitialized(reason: unknown): boolean {
  return reason instanceof SyncError && reason.code === "not_initialized";
}

function cloudFirstOpenError(reason: unknown): Error {
  return new Error(
    `The cloud collection needs a connection the first time it opens. ${cloudErrorMessage(reason)}`,
  );
}

function cloudErrorMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message) return reason.message;
  return "Changes will sync when a connection is available.";
}

function validResult<Result>(
  envelope: MdbaseOperationEnvelope<Result>,
): Result {
  if (!envelope.valid)
    throw new Error(
      envelope.diagnostics.map((item) => item.message).join(" ") ||
        "The collection rejected this view.",
    );
  return envelope.result;
}

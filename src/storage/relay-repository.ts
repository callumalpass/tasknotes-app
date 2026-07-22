import { Capacitor } from "@capacitor/core";
import { serializeMarkdownDocument } from "@tasknotes/model/frontmatter";
import {
  MdbaseConnectError,
  type JsonObject,
  type MdbaseConnect,
  type MdbaseOperationEnvelope,
  type RecordResult,
  type RecordSummary,
} from "@mdbase/connect";

import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { archiveMoveWarning } from "../domain/task-archive";
import { compareTasks, matchesArchiveFilter } from "./repository";
import { resolveTaskCollection } from "./tasknotes-collection";
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
  TaskTimeEntry,
  UpdateTaskInput,
} from "../domain/task";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskView, TaskViewExecution } from "../domain/view";
import type {
  CollectionInfo,
  RefreshResult,
  RepositorySyncIssue,
  RepositorySyncStatus,
  TaskRepository,
} from "./repository";

interface CachedRelayTask {
  task: Task;
  revision?: string;
}

const PAGE_SIZE = 1_000;

/**
 * A live TaskNotes view over the ordinary mdbase collection operation API.
 * Reads are cached for the current app session; writes require the collection
 * authority to be reachable and use revisions whenever one has been observed.
 */
export class RelayTaskRepository implements TaskRepository {
  private model = new TaskNotesTaskModel();
  private taskTypeName = "task";
  private displayName = "mdbase collection";
  private readonly cache = new Map<string, CachedRelayTask>();
  private readonly listeners = new Set<() => void>();
  private readonly writeTails = new Map<string, Promise<void>>();
  private initialization: Promise<void> | null = null;
  private refreshInFlight: Promise<RefreshResult> | null = null;
  private status: RepositorySyncStatus = {
    mode: "live",
    state: "syncing",
    pending: 0,
    issues: 0,
  };

  constructor(private readonly connect: MdbaseConnect<JsonObject>) {}

  initialize(): Promise<void> {
    this.initialization ??= this.initializeUnlocked();
    return this.initialization;
  }

  private async initializeUnlocked(): Promise<void> {
    const description = await this.connect.describe();
    const resolved = resolveTaskCollection(description);
    this.model = resolved.model;
    this.taskTypeName = resolved.typeName;
    this.displayName = description.display_name;
    await this.reloadCache();
    this.setConnected();
    this.emit();
  }

  refresh(): Promise<RefreshResult> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const run = this.refreshUnlocked().finally(() => {
      this.refreshInFlight = null;
    });
    this.refreshInFlight = run;
    return run;
  }

  private async refreshUnlocked(): Promise<RefreshResult> {
    const startedAt = performance.now();
    const before = new Map(
      [...this.cache.values()].map(({ task }) => [task.id, signature(task)]),
    );
    this.status = { ...this.status, state: "syncing", message: undefined };
    this.emit();
    try {
      await this.reloadCache();
      this.setConnected();
    } catch (reason) {
      this.setOffline(reason);
    }
    this.emit();

    let changed = 0;
    for (const { task } of this.cache.values())
      if (before.get(task.id) !== signature(task)) changed += 1;
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
        if (!matchesArchiveFilter(task, query)) return false;
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

  create(input: CreateTaskInput): Promise<Task> {
    const id = crypto.randomUUID();
    return this.serializeWrite(id, async () => {
      const task = await this.model.createWithTemplate(
        input,
        { id, now: new Date().toISOString() },
        async (path) => {
          const template = validResult(await this.connect.read({ path }));
          return serializeMarkdownDocument(
            template.raw_frontmatter ?? template.frontmatter,
            template.body ?? "",
          );
        },
      );
      try {
        const result = validResult(
          await this.connect.create({
            path: task.path,
            type: this.taskTypeName,
            frontmatter: asJson(task.frontmatter),
            body: task.body,
          }),
        );
        return this.storeResult(result);
      } catch (reason) {
        this.noteOperationFailure(reason);
        throw reason;
      }
    });
  }

  update(id: string, input: UpdateTaskInput): Promise<Task> {
    return this.serializeWrite(id, async () => {
      const current = await this.requireCurrent(id);
      const next = this.model.update(current.task, input, {
        now: new Date().toISOString(),
      });
      return this.persistUpdate(current, next);
    });
  }

  toggle(id: string, occurrenceDate?: string): Promise<Task> {
    return this.serializeWrite(id, async () => {
      const current = await this.requireCurrent(id);
      const next = this.model.toggle(current.task, {
        now: new Date().toISOString(),
        currentDate: occurrenceDate,
      });
      return this.persistUpdate(current, next);
    });
  }

  skip(id: string, occurrenceDate: string): Promise<Task> {
    return this.serializeWrite(id, async () => {
      const current = await this.requireCurrent(id);
      const next = this.model.skip(current.task, {
        now: new Date().toISOString(),
        currentDate: occurrenceDate,
      });
      return this.persistUpdate(current, next);
    });
  }

  startTimeTracking(id: string, description?: string): Promise<Task> {
    return this.persistModelMutation(id, (task) =>
      this.model.startTimeTracking(task, {
        now: new Date().toISOString(),
        description,
      }),
    );
  }

  stopTimeTracking(id: string): Promise<Task> {
    return this.persistModelMutation(id, (task) =>
      this.model.stopTimeTracking(task, { now: new Date().toISOString() }),
    );
  }

  replaceTimeEntries(id: string, entries: TaskTimeEntry[]): Promise<Task> {
    return this.persistModelMutation(id, (task) =>
      this.model.replaceTimeEntries(task, entries, {
        now: new Date().toISOString(),
      }),
    );
  }

  removeTimeEntry(id: string, index: number): Promise<Task> {
    return this.persistModelMutation(id, (task) =>
      this.model.removeTimeEntry(task, index, {
        now: new Date().toISOString(),
      }),
    );
  }

  setArchived(id: string, archived: boolean): Promise<Task> {
    return this.serializeWrite(id, async () => {
      const current = await this.requireCurrent(id);
      const next = this.model.update(
        current.task,
        { archived },
        { now: new Date().toISOString() },
      );
      const updated = await this.persistUpdate(current, next);
      const destination = this.model.archiveDestination(updated, archived);
      if (!destination) return updated;
      const saved = this.cache.get(id);
      try {
        const result = validResult(
          await this.connect.rename({
            from: updated.path,
            to: destination,
            if_revision: saved?.revision,
            update_refs: true,
          }),
        );
        return this.storeResult(result);
      } catch (reason) {
        this.noteOperationFailure(reason);
        const retained = {
          ...updated,
          operationWarnings: [archiveMoveWarning(reason, archived)],
        };
        this.cache.set(id, { task: retained, revision: saved?.revision });
        this.emit();
        return retained;
      }
    });
  }

  delete(id: string): Promise<void> {
    return this.serializeWrite(id, async () => {
      const existing = this.cache.get(id);
      if (!existing) return;
      const current = await this.requireCurrent(id);
      try {
        validResult(
          await this.connect.delete({
            path: current.task.path,
            if_revision: current.revision,
            check_backlinks: true,
          }),
        );
        this.cache.delete(id);
        this.setConnected();
        this.emit();
      } catch (reason) {
        this.noteOperationFailure(reason);
        throw reason;
      }
    });
  }

  async stats(): Promise<TaskStats> {
    let archived = 0;
    let completed = 0;
    let open = 0;
    for (const { task } of this.cache.values()) {
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

  async taskConfiguration(): Promise<TaskCollectionConfiguration> {
    return this.model.configuration();
  }

  async listViews(): Promise<TaskView[]> {
    try {
      return flattenViews(
        validResult(await this.connect.listViews()) as ProviderViewList,
      );
    } catch (reason) {
      this.noteOperationFailure(reason);
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
      return normalizeViewExecution(view, result, (record) =>
        this.readRecord({
          path: record.path,
          frontmatter: record.frontmatter ?? {},
          body: record.body,
          types: record.types ?? [],
        }),
      );
    } catch (reason) {
      this.noteOperationFailure(reason);
      throw reason;
    }
  }

  async collectionInfo(): Promise<CollectionInfo> {
    return {
      kind: "connect",
      name: this.displayName,
      location: "Live connection through mdbase",
      runtime: Capacitor.isNativePlatform() ? "native" : "browser",
    };
  }

  async syncStatus(): Promise<RepositorySyncStatus> {
    return { ...this.status };
  }

  async syncIssues(): Promise<RepositorySyncIssue[]> {
    return [];
  }

  async resolveSyncIssue(): Promise<void> {
    throw new Error("This live collection has no queued sync issues.");
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async reloadCache(): Promise<void> {
    const next = new Map<string, CachedRelayTask>();
    let offset = 0;
    let snapshot: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const response = await this.connect.query({
        types: [this.taskTypeName],
        include_body: true,
        limit: PAGE_SIZE,
        offset,
        ...(snapshot ? { snapshot } : {}),
      });
      const page = validResult(response);
      if (!snapshot && typeof page.meta?.snapshot === "string")
        snapshot = page.meta.snapshot;
      for (const record of page.results) {
        const task = this.readRecord(record);
        if (!task) continue;
        const cached = this.cache.get(task.id);
        next.set(task.id, {
          task,
          revision:
            cached && signature(cached.task) === signature(task)
              ? cached.revision
              : undefined,
        });
      }
      offset += page.results.length;
      hasMore = Boolean(page.meta?.has_more && page.results.length > 0);
    }

    this.cache.clear();
    for (const [id, value] of next) this.cache.set(id, value);
  }

  private async requireCurrent(id: string): Promise<Required<CachedRelayTask>> {
    const cached = this.cache.get(id);
    if (!cached) throw new Error("Task not found.");
    if (cached.revision) return cached as Required<CachedRelayTask>;
    try {
      const result = validResult(
        await this.connect.read({ path: cached.task.path }),
      );
      const task = this.readRecord(result);
      if (!task) throw new Error("The task is no longer readable.");
      const current = { task, revision: result.revision };
      if (task.id !== id) this.cache.delete(id);
      this.cache.set(task.id, current);
      return current;
    } catch (reason) {
      this.noteOperationFailure(reason);
      throw reason;
    }
  }

  private async persistUpdate(
    current: Required<CachedRelayTask>,
    next: Task,
  ): Promise<Task> {
    try {
      const result = validResult(
        await this.connect.update({
          path: current.task.path,
          patch: frontmatterPatch(current.task.frontmatter, next.frontmatter),
          body: next.body,
          if_revision: current.revision,
        }),
      );
      return this.storeResult(result);
    } catch (reason) {
      this.noteOperationFailure(reason);
      throw reason;
    }
  }

  private persistModelMutation(
    id: string,
    mutate: (task: Task) => Task,
  ): Promise<Task> {
    return this.serializeWrite(id, async () => {
      const current = await this.requireCurrent(id);
      return this.persistUpdate(current, mutate(current.task));
    });
  }

  private storeResult(result: RecordResult<JsonObject>): Task {
    const task = this.readRecord(result);
    if (!task) throw new Error("The saved task could not be read.");
    this.cache.set(task.id, { task, revision: result.revision });
    this.setConnected();
    this.emit();
    return task;
  }

  private readRecord(record: RecordSummary<JsonObject>): Task | null {
    try {
      return this.model.read({
        path: record.path,
        frontmatter: record.frontmatter,
        body: record.body ?? "",
      });
    } catch {
      return null;
    }
  }

  private serializeWrite<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.writeTails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.writeTails.set(key, tail);
    void tail.finally(() => {
      if (this.writeTails.get(key) === tail) this.writeTails.delete(key);
    });
    return result;
  }

  private setConnected(): void {
    this.status = {
      mode: "live",
      state: "synced",
      pending: 0,
      issues: 0,
      lastSyncedAt: new Date().toISOString(),
    };
  }

  private setOffline(reason: unknown): void {
    this.status = {
      ...this.status,
      state: "offline",
      message: connectionErrorMessage(reason),
    };
  }

  private noteOperationFailure(reason: unknown): void {
    if (isConnectionFailure(reason)) {
      this.setOffline(reason);
      this.emit();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function validResult<Result>(
  envelope: MdbaseOperationEnvelope<Result>,
): Result {
  if (!envelope.valid)
    throw new Error(
      envelope.diagnostics.map((item) => item.message).join(" ") ||
        "The collection rejected this change.",
    );
  return envelope.result;
}

function frontmatterPatch(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): JsonObject {
  const patch: JsonObject = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!(key in after)) patch[key] = null;
    else if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      patch[key] = structuredClone(after[key]) as JsonObject[string];
  }
  return patch;
}

function asJson(value: Record<string, unknown>): JsonObject {
  return structuredClone(value) as JsonObject;
}

function signature(task: Task): string {
  return JSON.stringify([task.path, task.frontmatter, task.body]);
}

function isConnectionFailure(reason: unknown): boolean {
  return (
    reason instanceof TypeError ||
    (reason instanceof MdbaseConnectError &&
      [
        "connector_offline",
        "authorization_expired",
        "not_authorized",
        "operation_failed",
      ].includes(reason.code))
  );
}

function connectionErrorMessage(reason: unknown): string {
  if (
    reason instanceof MdbaseConnectError &&
    reason.code === "connector_offline"
  )
    return "The computer holding this collection is offline.";
  if (reason instanceof Error && reason.message) return reason.message;
  return "This collection is not reachable right now.";
}

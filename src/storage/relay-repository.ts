import { Capacitor } from "@capacitor/core";
import { serializeMarkdownDocument } from "@tasknotes/model/frontmatter";
import {
  MdbaseConnectError,
  type JsonObject,
  type MdbaseConnection,
  type MdbaseOperationEnvelope,
  type RecordDocument,
} from "@mdbase/connect";

import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { archiveMoveWarning } from "../domain/task-archive";
import {
  findOccurrenceParent,
  findMaterializedOccurrenceTask,
  occurrenceRecordId,
  rollingOccurrenceDates,
} from "../domain/task-occurrence";
import { taskRelationships } from "../domain/task-relationships";
import { compareTasks, matchesArchiveFilter } from "./repository";
import { resolveTaskCollection } from "./tasknotes-collection";
import { TaskViewCache } from "./view-cache";
import {
  completeRecords,
  completeTaskValues,
  completionLimit,
} from "./completions";
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
} from "./repository";

interface CachedRelayTask {
  task: Task;
  revision?: string;
}

interface ReadableRelayRecord {
  path: string;
  frontmatter?: JsonObject;
  effective_frontmatter?: JsonObject;
  body?: string;
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
  private readonly reservedTaskPaths = new Set<string>();
  private readonly revisionReads = new Map<
    string,
    Promise<Required<CachedRelayTask>>
  >();
  private initialization: Promise<void> | null = null;
  private refreshInFlight: Promise<RefreshResult> | null = null;
  private readonly completionCache = new Map<
    string,
    { expiresAt: number; values: FieldCompletion[] }
  >();
  private readonly completionsInFlight = new Map<
    string,
    Promise<FieldCompletion[]>
  >();
  private status: RepositorySyncStatus = {
    mode: "live",
    state: "syncing",
    pending: 0,
    issues: 0,
  };

  constructor(private readonly connect: MdbaseConnection<JsonObject>) {}

  initialize(): Promise<void> {
    this.initialization ??= this.initializeUnlocked();
    return this.initialization;
  }

  private async initializeUnlocked(): Promise<void> {
    const description = await this.connect.describe();
    this.configureDescription(description);
    this.collectionId = description.collection_id;
    this.viewStore = new TaskViewCache(description.collection_id);
    this.viewCache = await this.viewStore.readViewDocuments().catch(() => []);
    await this.reloadCache();
    this.setConnected();
    await this.maintainRollingOccurrencesUnlocked();
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
      this.configureDescription(await this.connect.describe());
      await this.reloadCache();
      this.setConnected();
      await this.maintainRollingOccurrencesUnlocked();
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
    const cached = this.cache.get(id);
    if (cached && !cached.revision)
      void this.requireCurrent(id).catch(() => undefined);
    return cached?.task ?? null;
  }

  async relationships(id: string) {
    const current = this.cache.get(id)?.task;
    if (!current) throw new Error("Task not found.");
    return taskRelationships(
      current,
      [...this.cache.values()].map(({ task }) => task),
    );
  }

  async completeField(
    request: FieldCompletionRequest,
  ): Promise<FieldCompletion[]> {
    if (request.kind === "values")
      return completeTaskValues(
        [...this.cache.values()].map(({ task }) => task),
        request,
      );
    const key = JSON.stringify({
      field: request.field,
      query: request.query?.trim().toLocaleLowerCase() ?? "",
      limit: completionLimit(request),
      targetTypes: [...(request.targetTypes ?? [])].sort(),
    });
    const cached = this.completionCache.get(key);
    if (cached && cached.expiresAt > Date.now())
      return structuredClone(cached.values);
    const pending = this.completionsInFlight.get(key);
    if (pending) return pending;
    const run = this.completeRecordsFromProvider(request)
      .then((values) => {
        this.completionCache.set(key, {
          expiresAt: Date.now() + 30_000,
          values,
        });
        return structuredClone(values);
      })
      .finally(() => {
        if (this.completionsInFlight.get(key) === run)
          this.completionsInFlight.delete(key);
      });
    this.completionsInFlight.set(key, run);
    return run;
  }

  private async completeRecordsFromProvider(
    request: FieldCompletionRequest,
  ): Promise<FieldCompletion[]> {
    const query = request.query?.trim().toLocaleLowerCase() ?? "";
    const response = await this.connect.query({
      ...(request.targetTypes?.length
        ? { types: [...request.targetTypes] }
        : {}),
      ...(query
        ? {
            where: [
              `file.path.lower().contains(${JSON.stringify(query)})`,
              `file.basename.lower().contains(${JSON.stringify(query)})`,
              `note.title.lower().contains(${JSON.stringify(query)})`,
            ].join(" || "),
          }
        : {}),
      order_by: [{ field: "file.path", direction: "asc" }],
      limit: Math.max(completionLimit(request) * 4, 48),
      frontmatter_mode: "effective",
    });
    const result = validResult(response);
    const records: CollectionRecord[] = result.results.map((record) => {
      const frontmatter = relayFrontmatter(record);
      return {
        path: record.path,
        label:
          typeof frontmatter.title === "string"
            ? frontmatter.title
            : (record.path.split("/").at(-1)?.replace(/\.md$/i, "") ??
              record.path),
        frontmatter,
        body: record.body,
        types: record.types,
      };
    });
    return completeRecords(
      records,
      request,
      this.model.configuration().linkWriteFormat,
    );
  }

  create(input: CreateTaskInput): Promise<Task> {
    const id = crypto.randomUUID();
    return this.serializeWrite(id, async () => {
      const created = await this.model.createWithTemplate(
        input,
        { id, now: new Date().toISOString() },
        async (path) => {
          const template = validResult(await this.connect.read({ path }));
          return serializeMarkdownDocument(template.frontmatter, template.body);
        },
      );
      const task = this.reserveAvailableTaskPath(created);
      try {
        const result = validResult(
          await this.connect.create({
            path: task.path,
            type: this.taskTypeName,
            frontmatter: asJson(task.frontmatter),
            body: task.body,
          }),
        );
        return this.withRollingWarnings(this.storeResult(result));
      } catch (reason) {
        this.noteOperationFailure(reason);
        throw reason;
      } finally {
        this.reservedTaskPaths.delete(task.path);
      }
    });
  }

  update(id: string, input: UpdateTaskInput): Promise<Task> {
    return this.serializeWrite(id, async () => {
      const current = await this.requireCurrent(id);
      const next = this.model.update(current.task, input, {
        now: new Date().toISOString(),
      });
      return this.withRollingWarnings(await this.persistUpdate(current, next));
    });
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
      const current = await this.requireCurrent(id);
      const next = this.model.toggle(current.task, {
        now: new Date().toISOString(),
        currentDate: occurrenceDate,
      });
      return this.persistUpdate(current, next);
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
      const current = await this.requireCurrent(id);
      const next = this.model.skip(current.task, {
        now: new Date().toISOString(),
        currentDate: occurrenceDate,
      });
      return this.persistUpdate(current, next);
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

  async taskModelSettingsAccess() {
    return {
      writable: false,
      source: `${this.taskTypeName} type contract`,
      reason:
        "Connected collection type settings are managed by the collection owner.",
    };
  }

  async updateTaskModelSettings(): Promise<TaskCollectionConfiguration> {
    throw new Error(
      "Connected collection type settings are managed by the collection owner.",
    );
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
      this.noteOperationFailure(reason);
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
      const execution = normalizeViewExecution(view, result, (record) =>
        this.readRecord(record),
      );
      this.viewExecutionCache.set(viewExecutionKey(view), execution);
      await this.viewStore?.writeExecution(execution).catch(() => undefined);
      return execution;
    } catch (reason) {
      this.noteOperationFailure(reason);
      const cached = await this.cachedViewExecution(view);
      if (cached) return { ...cached, stale: true };
      throw reason;
    }
  }

  async readViewSource(path: string): Promise<TaskViewSourceDocument> {
    try {
      return validResult(await this.connect.readViewSource({ path }));
    } catch (reason) {
      this.noteOperationFailure(reason);
      throw reason;
    }
  }

  async createViewSource(
    input: CreateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument> {
    try {
      const created = validResult(
        await this.connect.createViewSource({
          ...input,
        }),
      );
      this.invalidateViewsAfterMutation();
      return created;
    } catch (reason) {
      this.noteOperationFailure(reason);
      throw reason;
    }
  }

  async updateViewSource(
    input: UpdateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument> {
    try {
      const updated = validResult(
        await this.connect.updateViewSource({
          path: input.path,
          document: input.document,
          if_revision: input.ifRevision,
        }),
      );
      this.invalidateViewsAfterMutation();
      return updated;
    } catch (reason) {
      this.noteOperationFailure(reason);
      throw reason;
    }
  }

  async deleteViewSource(path: string, ifRevision?: string): Promise<void> {
    try {
      validResult(
        await this.connect.deleteViewSource({
          path,
          if_revision: ifRevision,
        }),
      );
      this.invalidateViewsAfterMutation();
    } catch (reason) {
      this.noteOperationFailure(reason);
      throw reason;
    }
  }

  private invalidateViewsAfterMutation(): void {
    this.viewExecutionCache.clear();
  }

  async collectionInfo(): Promise<CollectionInfo> {
    return {
      kind: "connect",
      id: this.collectionId,
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
        frontmatter_mode: "effective",
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
    const pending = this.revisionReads.get(id);
    if (pending) return pending;
    const read = this.readCurrent(id, cached).finally(() => {
      if (this.revisionReads.get(id) === read) this.revisionReads.delete(id);
    });
    this.revisionReads.set(id, read);
    return read;
  }

  private async readCurrent(
    id: string,
    cached: CachedRelayTask,
  ): Promise<Required<CachedRelayTask>> {
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

  private configureDescription(
    description: Awaited<ReturnType<MdbaseConnection<JsonObject>["describe"]>>,
  ): void {
    const resolved = resolveTaskCollection(description);
    if (this.collectionId && description.collection_id !== this.collectionId)
      throw new Error("The connected mdbase collection changed unexpectedly.");
    this.model = resolved.model;
    this.taskTypeName = resolved.typeName;
    this.displayName = description.display_name;
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

  private storeResult(result: RecordDocument<JsonObject>): Task {
    const task = this.readRecord(result);
    if (!task) throw new Error("The saved task could not be read.");
    this.cache.set(task.id, { task, revision: result.revision });
    this.setConnected();
    this.emit();
    return task;
  }

  private readRecord(record: ReadableRelayRecord): Task | null {
    try {
      return this.model.read({
        path: record.path,
        frontmatter: relayFrontmatter(record),
        body: record.body ?? "",
      });
    } catch {
      return null;
    }
  }

  private async materializeOccurrenceUnlocked(
    parentId: string,
    occurrenceDate: string,
  ): Promise<MaterializeOccurrenceResult> {
    const parent = await this.requireCurrent(parentId);
    const occurrences = [...this.cache.values()]
      .map(({ task }) => task)
      .filter((task) => task.recurrenceParent && task.occurrenceDate);
    const resolved = findMaterializedOccurrenceTask(
      [...this.cache.values()].map(({ task }) => task),
      parent.task,
      occurrenceDate,
    );
    if (resolved) return { task: resolved, created: false, warnings: [] };
    const result = await this.model.materializeOccurrence(
      parent.task,
      occurrenceDate,
      occurrences,
      {
        id: await occurrenceRecordId(parent.task.id, occurrenceDate),
        now: new Date().toISOString(),
      },
      async (path) => {
        const template = validResult(await this.connect.read({ path }));
        return serializeMarkdownDocument(template.frontmatter, template.body);
      },
    );
    if (!result.created) return result;
    const created = this.reserveAvailableTaskPath(result.task);
    try {
      const saved = this.storeResult(
        validResult(
          await this.connect.create({
            path: created.path,
            type: this.taskTypeName,
            frontmatter: asJson(created.frontmatter),
            body: created.body,
          }),
        ),
      );
      const task = result.warnings.length
        ? { ...saved, operationWarnings: result.warnings }
        : saved;
      const cached = this.cache.get(saved.id);
      this.cache.set(saved.id, { task, revision: cached?.revision });
      return { ...result, task };
    } catch (reason) {
      try {
        const existing = validResult(
          await this.connect.read({ path: created.path }),
        );
        const task = this.storeResult(existing);
        if (
          task.occurrenceDate === occurrenceDate &&
          findOccurrenceParent(
            [...this.cache.values()].map(({ task: candidate }) => candidate),
            task,
          )?.id === parent.task.id
        )
          return { task, created: false, warnings: result.warnings };
      } catch {
        // Preserve the original create failure when no idempotent record exists.
      }
      this.noteOperationFailure(reason);
      throw reason;
    } finally {
      this.reservedTaskPaths.delete(created.path);
    }
  }

  private reserveAvailableTaskPath(task: Task): Task {
    const occupied = new Set([
      ...this.reservedTaskPaths,
      ...[...this.cache.values()].map(({ task: cached }) => cached.path),
    ]);
    let path = task.path;
    if (occupied.has(path)) {
      const extension = /\.md$/i.test(path) ? ".md" : "";
      const stem = extension ? path.slice(0, -extension.length) : path;
      let allocated = "";
      for (let index = 2; index < 10_000; index += 1) {
        const candidate = `${stem}-${index}${extension}`;
        if (occupied.has(candidate)) continue;
        allocated = candidate;
        break;
      }
      if (!allocated)
        throw new Error(
          "task_path_collision: Could not allocate a unique task path.",
        );
      path = allocated;
    }
    this.reservedTaskPaths.add(path);
    return path === task.path ? task : { ...task, path };
  }

  private async transitionMaterializedUnlocked(
    occurrenceId: string,
    parentId: string,
    action: "toggle" | "skip",
  ): Promise<Task> {
    const [occurrence, parent] = await Promise.all([
      this.requireCurrent(occurrenceId),
      this.requireCurrent(parentId),
    ]);
    const transition = this.model.transitionMaterializedOccurrence(
      occurrence.task,
      parent.task,
      action,
      { now: new Date().toISOString() },
    );
    const savedOccurrence = await this.persistUpdate(
      occurrence,
      transition.occurrence,
    );
    const warnings: string[] = [];
    try {
      await this.persistUpdate(parent, transition.parent);
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
        );
      } catch (reason) {
        warnings.push(
          `next_occurrence_materialization_failed: ${errorMessage(reason)}`,
        );
      }
    }
    if (!warnings.length) return savedOccurrence;
    const task = { ...savedOccurrence, operationWarnings: warnings };
    const cached = this.cache.get(task.id);
    this.cache.set(task.id, { task, revision: cached?.revision });
    this.emit();
    return task;
  }

  private async withRollingWarnings(task: Task): Promise<Task> {
    if (!task.recurrence || task.occurrenceMaterialization !== "rolling")
      return task;
    const warnings = await this.materializeRollingWindow(task);
    if (!warnings.length) return task;
    const retained = { ...task, operationWarnings: warnings };
    const cached = this.cache.get(task.id);
    this.cache.set(task.id, { task: retained, revision: cached?.revision });
    this.emit();
    return retained;
  }

  private async maintainRollingOccurrencesUnlocked(): Promise<void> {
    const parents = [...this.cache.values()]
      .map(({ task }) => task)
      .filter(
        (task) =>
          task.recurrence && task.occurrenceMaterialization === "rolling",
      );
    for (const parent of parents) {
      const warnings = await this.materializeRollingWindow(parent);
      if (!warnings.length) continue;
      const cached = this.cache.get(parent.id);
      if (cached)
        this.cache.set(parent.id, {
          ...cached,
          task: { ...cached.task, operationWarnings: warnings },
        });
    }
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
      const message = connectionErrorMessage(reason);
      if (this.status.state === "offline" && this.status.message === message)
        return;
      this.setOffline(reason);
      this.emit();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function viewExecutionKey(view: TaskView): string {
  return `${view.key}:${view.source.revision}`;
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

function relayFrontmatter(record: ReadableRelayRecord): JsonObject {
  return record.effective_frontmatter ?? record.frontmatter ?? {};
}

function signature(task: Task): string {
  return JSON.stringify([task.path, task.frontmatter, task.body]);
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
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

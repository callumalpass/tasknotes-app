import { Capacitor } from "@capacitor/core";
import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import { patchTaskNotesMdbaseTypeSettings } from "@tasknotes/model/mdbase";
import {
  MdbaseConnectError,
  type CollectionDescription,
  type ConnectOutcome,
  type JsonObject,
  type MdbaseConnection,
  type MdbaseDiagnostic,
  type MdbaseOperationEnvelope,
  type RecordDocument,
} from "@mdbase-dev/connect";

import { requireConnectOutcome } from "../cloud/outcome";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { assertPersistableMarkdownWikilinks } from "../domain/markdown-validation";
import { archiveMoveWarning } from "../domain/task-archive";
import { runtimeTimezone } from "../domain/runtime-timezone";
import {
  findOccurrenceParent,
  findMaterializedOccurrenceTask,
  occurrenceRecordId,
  rollingOccurrenceDates,
} from "../domain/task-occurrence";
import {
  connectedTaskRelationships,
  connectedTaskSignature as signature,
  connectedTaskStats,
  connectedViewExecutionKey as viewExecutionKey,
  listConnectedTasks,
} from "./connected-task-cache";
import {
  mdbaseMutationKey,
  runMdbaseMutation,
} from "./mdbase-mutation-coordinator";
import { MdbaseCollectionFileStore } from "./mdbase-files";
import {
  activeScratchpad,
  assertActiveScratchpad,
  assertScratchpadRebase,
  assertScratchpadRevision,
  newScratchpadValues,
  scratchpadFromRecord,
  scratchpadFrontmatter,
} from "./scratchpads";
import {
  scratchImageFromRecord,
  scratchImageFrontmatter,
} from "./scratch-images";
import {
  SCRATCH_IMAGE_TYPE,
  type CreateScratchImageInput,
  type ScratchImage,
} from "../domain/scratch-image";
import {
  scratchFeedPage,
  scratchpadFeedItem,
  type ScratchFeedItem,
  type ScratchFeedPageRequest,
} from "../domain/scratch-feed";
import {
  SCRATCHPAD_TYPE,
  scratchpadPage,
  type ArchiveScratchpadInput,
  type SaveScratchpadInput,
  type ScratchpadPageRequest,
  type StartNewScratchpadInput,
} from "../domain/scratchpad";
import {
  resolveTaskCollection,
  resolveTaskTypeDefinition,
} from "./tasknotes-collection";
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
import type {
  TaskCollectionConfiguration,
  TaskModelSettingsPatch,
} from "../domain/task-configuration";
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
  RepositoryConnectionStatus,
  TaskRepository,
} from "../application/ports/task-repository";

interface CachedMdbaseTask {
  task: Task;
  revision?: string;
  model: TaskNotesTaskModel;
  typeName: string;
}

interface ReadableMdbaseRecord {
  path: string;
  frontmatter?: JsonObject;
  effectiveFrontmatter?: JsonObject;
  body?: string;
  types?: string[];
}

const PAGE_SIZE = 1_000;

/**
 * A live TaskNotes view over the ordinary mdbase collection operation API.
 * Reads are cached for the current app session; writes require the collection
 * authority to be reachable and use revisions whenever one has been observed.
 */
export class MdbaseTaskRepository implements TaskRepository {
  readonly files: MdbaseCollectionFileStore;
  private operationController = new AbortController();
  private model = new TaskNotesTaskModel();
  private taskTypeName = "task";
  private taskProviders = new Map<string, TaskNotesTaskModel>([
    ["task", this.model],
  ]);
  private displayName = "mdbase collection";
  private readonly cache = new Map<string, CachedMdbaseTask>();
  private viewCache: TaskViewDocument[] = [];
  private readonly viewExecutionCache = new Map<string, TaskViewExecution>();
  private readonly viewExecutionInFlight = new Map<
    string,
    { signal: AbortSignal; promise: Promise<TaskViewExecution> }
  >();
  private collectionId = "";
  private readonly listeners = new Set<() => void>();
  private readonly writeTails = new Map<string, Promise<void>>();
  private emitBatchDepth = 0;
  private emitPending = false;
  private readonly reservedTaskPaths = new Set<string>();
  private readonly revisionReads = new Map<
    string,
    Promise<Required<CachedMdbaseTask>>
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
  private scratchFeedSnapshot?: {
    current: import("../domain/scratchpad").ScratchpadDocument;
    items: ScratchFeedItem[];
  };
  private status: RepositoryConnectionStatus = {
    state: "connecting",
  };

  constructor(private readonly connect: MdbaseConnection<JsonObject>) {
    this.files = new MdbaseCollectionFileStore(
      connect,
      () => this.operationController.signal,
    );
  }

  suspend(): void {
    this.operationController.abort(
      new DOMException("TaskNotes moved to the background.", "AbortError"),
    );
  }

  resume(): void {
    if (this.operationController.signal.aborted) {
      this.operationController = new AbortController();
      // A lifecycle interruption can abort the first initialization attempt
      // (including React Strict Mode's development remount). Do not retain that
      // rejected promise: the resumed owner must be able to open the same
      // repository with the fresh lifecycle signal.
      this.initialization = null;
    }
  }

  dispose(): void {
    this.operationController.abort(
      new DOMException("The TaskNotes collection changed.", "AbortError"),
    );
  }

  initialize(): Promise<void> {
    this.initialization ??= this.initializeUnlocked();
    return this.initialization;
  }

  private async initializeUnlocked(): Promise<void> {
    const description = validResult(
      await this.connect.describe(this.requestOptions()),
    );
    this.configureDescription(description);
    this.collectionId = description.collectionId;
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
    this.status = { ...this.status, state: "connecting", message: undefined };
    this.emit();
    try {
      this.configureDescription(
        validResult(await this.connect.describe(this.requestOptions())),
      );
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
    return listConnectedTasks(this.cache.values(), query);
  }

  async get(id: string): Promise<Task | null> {
    const cached = this.cache.get(id);
    if (cached && !cached.revision)
      void this.requireCurrent(id).catch(() => undefined);
    return cached?.task ?? null;
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
    const response = await this.connect.query(
      {
        timezone: runtimeTimezone(),
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
        orderBy: [{ field: "file.path", direction: "asc" }],
        limit: Math.max(completionLimit(request) * 4, 48),
        frontmatterMode: "effective",
      },
      this.requestOptions(),
    );
    const result = validResult(response);
    const records: CollectionRecord[] = result.results.map((record) => {
      const frontmatter = mdbaseFrontmatter(record);
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
          const template = validResult(
            await this.connect.read({ path }, this.requestOptions()),
          );
          return serializeMarkdownDocument(template.frontmatter, template.body);
        },
      );
      const task = this.reserveAvailableTaskPath(created);
      const operationInput = {
        path: task.path,
        type: this.taskTypeName,
        frontmatter: asJson(task.frontmatter),
        body: task.body,
      };
      try {
        assertPersistableMarkdownWikilinks(operationInput.body);
        const saved = await runMdbaseMutation(
          this.connect,
          async () =>
            this.storeResult(
              validResult(
                await this.connect.create(
                  operationInput,
                  this.requestOptions(),
                ),
              ),
            ),
          {
            key: mdbaseMutationKey("record:create", operationInput),
            request: this.requestOptions(),
            mapRecovered: (result: RecordDocument<JsonObject>) =>
              this.storeResult(result),
          },
        );
        return this.withRollingWarnings(saved);
      } catch (reason) {
        this.noteOperationFailure(reason);
        throw reason;
      } finally {
        this.reservedTaskPaths.delete(task.path);
      }
    });
  }

  update(id: string, input: UpdateTaskInput): Promise<Task> {
    return this.serializeWrite(id, () => this.updateUnlocked(id, input));
  }

  updateMany(
    updates: readonly { id: string; input: UpdateTaskInput }[],
  ): Promise<Task[]> {
    if (!updates.length) return Promise.resolve([]);
    return this.serializeWrites(
      updates.map(({ id }) => id),
      () =>
        this.withBatchedEmits(async () => {
          const tasks: Task[] = [];
          for (const { id, input } of updates)
            tasks.push(await this.updateUnlocked(id, input));
          return tasks;
        }),
    );
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
      const next = current.model.toggle(current.task, {
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
      const next = current.model.skip(current.task, {
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
    return this.persistModelMutation(id, (task, model) =>
      model.startTimeTracking(task, {
        now: new Date().toISOString(),
        description,
      }),
    );
  }

  stopTimeTracking(id: string): Promise<Task> {
    return this.persistModelMutation(id, (task, model) =>
      model.stopTimeTracking(task, { now: new Date().toISOString() }),
    );
  }

  replaceTimeEntries(id: string, entries: TaskTimeEntry[]): Promise<Task> {
    return this.persistModelMutation(id, (task, model) =>
      model.replaceTimeEntries(task, entries, {
        now: new Date().toISOString(),
      }),
    );
  }

  removeTimeEntry(id: string, index: number): Promise<Task> {
    return this.persistModelMutation(id, (task, model) =>
      model.removeTimeEntry(task, index, {
        now: new Date().toISOString(),
      }),
    );
  }

  setArchived(id: string, archived: boolean): Promise<Task> {
    return this.serializeWrite(id, async () => {
      const current = await this.requireCurrent(id);
      const next = current.model.update(
        current.task,
        { archived },
        { now: new Date().toISOString() },
      );
      const updated = await this.persistUpdate(current, next);
      const destination = current.model.archiveDestination(updated, archived);
      if (!destination) return updated;
      const saved = this.cache.get(id);
      const operationInput = {
        from: updated.path,
        to: destination,
        ifRevision: saved?.revision,
        update_refs: true,
      };
      try {
        return await runMdbaseMutation(
          this.connect,
          async () =>
            this.storeResult(
              validResult(
                await this.connect.rename(
                  operationInput,
                  this.requestOptions(),
                ),
              ),
            ),
          {
            key: mdbaseMutationKey("record:rename", operationInput),
            request: this.requestOptions(),
            mapRecovered: (result: RecordDocument<JsonObject>) =>
              this.storeResult(result),
          },
        );
      } catch (reason) {
        this.noteOperationFailure(reason);
        const retained = {
          ...updated,
          operationWarnings: [archiveMoveWarning(reason, archived)],
        };
        if (saved)
          this.cache.set(id, {
            ...saved,
            task: retained,
            revision: saved.revision,
          });
        this.emit();
        return retained;
      }
    });
  }

  delete(
    id: string,
    options: { authorityRequestId?: string } = {},
  ): Promise<void> {
    return this.serializeWrite(id, async () => {
      const existing = this.cache.get(id);
      if (!existing) return;
      const current = await this.requireCurrent(id);
      const operationInput = {
        path: current.task.path,
        ifRevision: current.revision,
        check_backlinks: true,
      };
      try {
        const applyDeleted = () => {
          this.cache.delete(id);
          this.setConnected();
          this.emit();
        };
        await runMdbaseMutation(
          this.connect,
          async () => {
            validResult(
              await this.connect.delete(operationInput, this.requestOptions()),
            );
            applyDeleted();
          },
          {
            key: mdbaseMutationKey("record:delete", operationInput),
            request: this.requestOptions(),
            mapRecovered: applyDeleted,
            ...(options.authorityRequestId
              ? { requestId: options.authorityRequestId }
              : {}),
          },
        );
      } catch (reason) {
        this.noteOperationFailure(reason);
        throw reason;
      }
    });
  }

  async stats(): Promise<TaskStats> {
    return connectedTaskStats(this.cache.values());
  }

  async taskConfiguration(): Promise<TaskCollectionConfiguration> {
    return this.model.configuration();
  }

  async taskModelSettingsAccess() {
    try {
      validResult(
        await this.connect.readType(
          { name: this.taskTypeName },
          this.requestOptions(),
        ),
      );
      return {
        writable: true as const,
        source: `${this.taskTypeName} type definition`,
      };
    } catch {
      return {
        writable: false as const,
        source: `${this.taskTypeName} type definition`,
        reason:
          "Task model settings need definition read and update access. Reauthorize this collection if it was connected before these settings were added.",
      };
    }
  }

  async updateTaskModelSettings(
    patch: TaskModelSettingsPatch,
  ): Promise<TaskCollectionConfiguration> {
    const current = validResult(
      await this.connect.readType(
        { name: this.taskTypeName },
        this.requestOptions(),
      ),
    );
    const parsed = parseFrontmatter(current.document);
    const definition = patchTaskNotesMdbaseTypeSettings(
      parsed.frontmatter,
      patch,
    );
    const operationInput = {
      path: current.path,
      document: serializeMarkdownDocument(definition, parsed.body),
      ifRevision: current.revision,
    };
    const applyUpdated = (updated: typeof current) => {
      const updatedDefinition = parseFrontmatter(updated.document).frontmatter;
      const provider = resolveTaskTypeDefinition(updatedDefinition, {
        typeName: this.taskTypeName,
      });
      this.model = provider.model;
      this.taskProviders.set(this.taskTypeName, provider.model);
      this.setConnected();
      this.emit();
      return this.model.configuration();
    };
    try {
      return await runMdbaseMutation(
        this.connect,
        async () =>
          applyUpdated(
            validResult(
              await this.connect.updateType(
                operationInput,
                this.requestOptions(),
              ),
            ),
          ),
        {
          key: mdbaseMutationKey("type:update-task-model", operationInput),
          request: this.requestOptions(),
          mapRecovered: applyUpdated,
        },
      );
    } catch (reason) {
      this.noteOperationFailure(reason);
      throw reason;
    }
  }

  async listViews(): Promise<TaskViewDocument[]> {
    try {
      this.viewCache = normalizeViewDocuments(
        validResult(
          await this.connect.listViews(this.requestOptions()),
        ) as ProviderViewList,
      );
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
    const key = this.viewExecutionKey(view, runtimeTimezone());
    const cached = this.viewExecutionCache.get(key);
    if (!cached) return null;
    this.viewExecutionCache.set(key, cached);
    return structuredClone(cached);
  }

  async executeView(view: TaskView): Promise<TaskViewExecution> {
    const timezone = runtimeTimezone();
    const key = this.viewExecutionKey(view, timezone);
    const signal = this.operationController.signal;
    const pending = this.viewExecutionInFlight.get(key);
    if (pending?.signal === signal) return pending.promise;
    const execution = this.executeViewUnlocked(
      view,
      timezone,
      key,
      signal,
    ).finally(() => {
      if (this.viewExecutionInFlight.get(key)?.promise === execution)
        this.viewExecutionInFlight.delete(key);
    });
    this.viewExecutionInFlight.set(key, { signal, promise: execution });
    return execution;
  }

  private async executeViewUnlocked(
    view: TaskView,
    timezone: string,
    cacheKey: string,
    signal: AbortSignal,
  ): Promise<TaskViewExecution> {
    try {
      signal.throwIfAborted();
      let result: ProviderViewExecution | undefined;
      for await (const outcome of this.connect.executeViewPages(
        {
          path: view.source.path,
          view: view.id,
          timezone,
          render: false,
        },
        {
          firstPageSize: PAGE_SIZE,
          pageSize: PAGE_SIZE,
          signal,
        },
      )) {
        signal.throwIfAborted();
        const page = validResult(outcome) as ProviderViewExecution & {
          page: number;
        };
        result ??= { results: [], meta: page.meta, diagnostics: [] };
        result.results.push(...page.results);
        result.diagnostics?.push(...operationDiagnostics(outcome));
        result.meta = {
          ...page.meta,
          ...(page.meta.groups === undefined && result.meta.groups
            ? { groups: result.meta.groups }
            : {}),
        };
      }
      signal.throwIfAborted();
      if (!result)
        throw new Error("Saved view execution completed without a page.");
      const execution = normalizeViewExecution(
        view,
        result,
        (record) => this.readRecord(record)?.task ?? null,
      );
      signal.throwIfAborted();
      this.viewExecutionCache.set(cacheKey, execution);
      return execution;
    } catch (reason) {
      this.noteOperationFailure(reason);
      const cached = this.viewExecutionCache.get(cacheKey);
      if (cached) return { ...structuredClone(cached), stale: true };
      throw reason;
    }
  }

  async readViewSource(path: string): Promise<TaskViewSourceDocument> {
    try {
      return validResult(
        await this.connect.readViewSource({ path }, this.requestOptions()),
      );
    } catch (reason) {
      this.noteOperationFailure(reason);
      throw reason;
    }
  }

  async createViewSource(
    input: CreateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument> {
    try {
      const operationInput = { ...input };
      const applyCreated = (created: TaskViewSourceDocument) => {
        this.invalidateViewsAfterMutation();
        return created;
      };
      return await runMdbaseMutation(
        this.connect,
        async () =>
          applyCreated(
            validResult(
              await this.connect.createViewSource(
                operationInput,
                this.requestOptions(),
              ),
            ),
          ),
        {
          key: mdbaseMutationKey("view-source:create", operationInput),
          request: this.requestOptions(),
          mapRecovered: applyCreated,
        },
      );
    } catch (reason) {
      this.noteOperationFailure(reason);
      throw reason;
    }
  }

  async updateViewSource(
    input: UpdateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument> {
    const operationInput = {
      path: input.path,
      document: input.document,
      ifRevision: input.ifRevision,
    };
    try {
      const applyUpdated = (updated: TaskViewSourceDocument) => {
        this.invalidateViewsAfterMutation();
        return updated;
      };
      return await runMdbaseMutation(
        this.connect,
        async () =>
          applyUpdated(
            validResult(
              await this.connect.updateViewSource(
                operationInput,
                this.requestOptions(),
              ),
            ),
          ),
        {
          key: mdbaseMutationKey("view-source:update", operationInput),
          request: this.requestOptions(),
          mapRecovered: applyUpdated,
        },
      );
    } catch (reason) {
      this.noteOperationFailure(reason);
      throw reason;
    }
  }

  async deleteViewSource(path: string, ifRevision?: string): Promise<void> {
    const operationInput = { path, ifRevision };
    try {
      const applyDeleted = () => {
        this.invalidateViewsAfterMutation();
      };
      await runMdbaseMutation(
        this.connect,
        async () => {
          validResult(
            await this.connect.deleteViewSource(
              operationInput,
              this.requestOptions(),
            ),
          );
          applyDeleted();
        },
        {
          key: mdbaseMutationKey("view-source:delete", operationInput),
          request: this.requestOptions(),
          mapRecovered: applyDeleted,
        },
      );
    } catch (reason) {
      this.noteOperationFailure(reason);
      throw reason;
    }
  }

  listScratchFeed(request: ScratchFeedPageRequest = {}) {
    return this.serializeWrite("scratchpad:active", async () => {
      if (!request.cursor || !this.scratchFeedSnapshot) {
        let scratchRecords = await this.scratchpadRecords();
        const current = await this.ensureActiveScratchpad(scratchRecords);
        if (
          !scratchRecords.some((record) => record.frontmatter.id === current.id)
        )
          scratchRecords = await this.scratchpadRecords();
        const images = await this.scratchImageRecords();
        this.scratchFeedSnapshot = {
          current,
          items: [
            ...scratchRecords
              .map(scratchpadFromRecord)
              .filter((item) => item.id !== current.id)
              .map(scratchpadFeedItem),
            ...images.map(scratchImageFromRecord),
          ],
        };
      }
      return scratchFeedPage(
        this.scratchFeedSnapshot.current,
        this.scratchFeedSnapshot.items,
        request,
      );
    });
  }

  async createScratchImage(
    input: CreateScratchImageInput,
  ): Promise<ScratchImage> {
    const operationInput = {
      path: input.path,
      type: SCRATCH_IMAGE_TYPE,
      frontmatter: asJson(scratchImageFrontmatter(input)),
      body: "",
    };
    const created = await runMdbaseMutation(
      this.connect,
      async () =>
        validResult(
          await this.connect.create(operationInput, this.requestOptions()),
        ),
      {
        key: mdbaseMutationKey("scratch-image:create", operationInput),
        mapRecovered: (result: RecordDocument<JsonObject>) => result,
        request: this.requestOptions(),
      },
    );
    this.scratchFeedSnapshot = undefined;
    this.emit();
    return scratchImageFromRecord(created);
  }

  async getScratchImage(
    id: string,
    path?: string,
  ): Promise<ScratchImage | null> {
    if (path) {
      try {
        const record = validResult(
          await this.connect.read({ path }, this.requestOptions()),
        );
        const image = scratchImageFromRecord(record);
        return image.id === id ? image : null;
      } catch {
        return null;
      }
    }
    const record = (await this.scratchImageRecords()).find(
      (candidate) => candidate.frontmatter.id === id,
    );
    return record ? scratchImageFromRecord(record) : null;
  }

  async removeScratchImage(
    image: Pick<ScratchImage, "id" | "path" | "revision">,
  ): Promise<void> {
    const current = await this.getScratchImage(image.id, image.path);
    if (!current)
      throw new Error("The image feed record is no longer available.");
    if (current.revision !== image.revision)
      throw new Error(
        "This image record changed after it was opened. Reload it before removing.",
      );
    const operationInput = { path: current.path, ifRevision: current.revision };
    await runMdbaseMutation(
      this.connect,
      async () => {
        validResult(
          await this.connect.delete(operationInput, this.requestOptions()),
        );
      },
      {
        key: mdbaseMutationKey("scratch-image:remove", operationInput),
        mapRecovered: () => undefined,
        request: this.requestOptions(),
      },
    );
    // Deliberately do not call files.delete: metadata removal is non-destructive.
    this.scratchFeedSnapshot = undefined;
    this.emit();
  }

  listScratchpads(request: ScratchpadPageRequest = {}) {
    return this.serializeWrite("scratchpad:active", async () => {
      let records = await this.scratchpadRecords();
      if (!activeScratchpad(records)) {
        await this.ensureActiveScratchpad(records);
        records = await this.scratchpadRecords();
      }
      return scratchpadPage(records.map(scratchpadFromRecord), request);
    });
  }

  async getScratchpad(id: string) {
    const record = (await this.scratchpadRecords()).find(
      (candidate) => candidate.frontmatter.id === id,
    );
    return record ? scratchpadFromRecord(record) : null;
  }

  getActiveScratchpad() {
    return this.serializeWrite("scratchpad:active", async () => {
      const active = await this.queryActiveScratchpad();
      return active ?? this.createActiveScratchpad();
    });
  }

  saveScratchpad(input: SaveScratchpadInput) {
    return this.serializeWrite(`scratchpad:${input.id}`, async () => {
      const record = await this.requireScratchpadRecord(input.id, input.path);
      const current = scratchpadFromRecord(record);
      assertScratchpadRebase(current, input);
      const operationInput = {
        path: current.path,
        ifRevision: current.revision,
        patch: asJson(
          scratchpadFrontmatter(current, {
            title: input.title,
            dateModified: new Date().toISOString(),
          }),
        ),
        body: input.body,
      };
      const updated = await this.mutateRecord(
        "scratchpad:save",
        operationInput,
      );
      this.setConnected();
      this.scratchFeedSnapshot = undefined;
      this.emit();
      return scratchpadFromRecord(updated);
    });
  }

  startNewScratchpad(input: StartNewScratchpadInput) {
    return this.serializeWrites(
      ["scratchpad:active", `scratchpad:${input.id}`],
      async () => {
        const record = await this.requireScratchpadRecord(input.id, input.path);
        const current = scratchpadFromRecord(record);
        assertActiveScratchpad(current);
        assertScratchpadRevision(current, input);
        const now = new Date().toISOString();
        const updateInput = {
          path: current.path,
          ifRevision: current.revision,
          patch: asJson(
            scratchpadFrontmatter(current, {
              state: "converted",
              title: input.title,
              dateModified: now,
              dateConverted: now,
            }),
          ),
          body: input.body,
        };
        const previous = await this.mutateRecord(
          "scratchpad:convert",
          updateInput,
        );
        const active = await this.createActiveScratchpad();
        this.setConnected();
        this.scratchFeedSnapshot = undefined;
        this.emit();
        return { previous: scratchpadFromRecord(previous), current: active };
      },
    );
  }

  async archiveScratchpad(input: ArchiveScratchpadInput) {
    const result = await this.startNewScratchpad(input);
    return { archived: result.previous, active: result.current };
  }

  private async scratchImageRecords(): Promise<RecordDocument<JsonObject>[]> {
    const result = validResult(
      await this.connect.query(
        {
          timezone: runtimeTimezone(),
          types: [SCRATCH_IMAGE_TYPE],
          includeBody: false,
          frontmatterMode: "persisted",
          limit: 1_000,
        },
        this.requestOptions(),
      ),
    );
    return Promise.all(
      result.results.map(async (record) =>
        validResult(
          await this.connect.read({ path: record.path }, this.requestOptions()),
        ),
      ),
    );
  }

  private async queryActiveScratchpad() {
    const result = validResult(
      await this.connect.query(
        {
          timezone: runtimeTimezone(),
          types: [SCRATCHPAD_TYPE],
          where: 'note.state == "active"',
          includeBody: false,
          frontmatterMode: "persisted",
          // Two results are enough to preserve the duplicate-active invariant.
          limit: 2,
        },
        this.requestOptions(),
      ),
    );
    const records = await Promise.all(
      result.results
        // Keep this guard for providers and test doubles that do not apply `where`.
        .filter((record) => mdbaseFrontmatter(record).state === "active")
        .map(async (record) =>
          validResult(
            await this.connect.read(
              { path: record.path },
              this.requestOptions(),
            ),
          ),
        ),
    );
    return activeScratchpad(records);
  }

  private async scratchpadRecords(): Promise<RecordDocument<JsonObject>[]> {
    const result = validResult(
      await this.connect.query(
        {
          timezone: runtimeTimezone(),
          types: [SCRATCHPAD_TYPE],
          includeBody: true,
          frontmatterMode: "persisted",
          limit: 1_000,
        },
        this.requestOptions(),
      ),
    );
    return Promise.all(
      result.results.map(async (record) =>
        validResult(
          await this.connect.read({ path: record.path }, this.requestOptions()),
        ),
      ),
    );
  }

  private async requireScratchpadRecord(
    id: string,
    path?: string,
  ): Promise<RecordDocument<JsonObject>> {
    if (path) {
      const record = validResult(
        await this.connect.read({ path }, this.requestOptions()),
      );
      if (record.frontmatter.id !== id)
        throw new Error("The scratchpad is no longer available.");
      return record;
    }
    const record = (await this.scratchpadRecords()).find(
      (candidate) => candidate.frontmatter.id === id,
    );
    if (!record) throw new Error("The scratchpad is no longer available.");
    return record;
  }

  private async ensureActiveScratchpad(
    records: readonly RecordDocument<JsonObject>[],
  ) {
    return activeScratchpad(records) ?? this.createActiveScratchpad();
  }

  private async createActiveScratchpad() {
    const values = newScratchpadValues();
    const operationInput = {
      path: values.path,
      type: SCRATCHPAD_TYPE,
      frontmatter: asJson(values.frontmatter),
      body: values.body,
    };
    const created = await runMdbaseMutation(
      this.connect,
      async () =>
        validResult(
          await this.connect.create(operationInput, this.requestOptions()),
        ),
      {
        key: mdbaseMutationKey("scratchpad:create", operationInput),
        mapRecovered: (result: RecordDocument<JsonObject>) => result,
        request: this.requestOptions(),
      },
    );
    return scratchpadFromRecord(created);
  }

  private mutateRecord(
    operation: string,
    input: Parameters<MdbaseConnection<JsonObject>["update"]>[0],
  ): Promise<RecordDocument<JsonObject>> {
    if (typeof input.body === "string")
      assertPersistableMarkdownWikilinks(input.body);
    return runMdbaseMutation(
      this.connect,
      async () =>
        validResult(await this.connect.update(input, this.requestOptions())),
      {
        key: mdbaseMutationKey(operation, input),
        mapRecovered: (result: RecordDocument<JsonObject>) => result,
        request: this.requestOptions(),
      },
    );
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

  async connectionStatus(): Promise<RepositoryConnectionStatus> {
    return { ...this.status };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private requestOptions(): { signal: AbortSignal } {
    return { signal: this.operationController.signal };
  }

  private viewExecutionKey(view: TaskView, timezone: string): string {
    return `${timezone}\u0000${viewExecutionKey(view)}`;
  }

  private async reloadCache(): Promise<void> {
    const next = new Map<string, CachedMdbaseTask>();
    const timezone = runtimeTimezone();
    for await (const response of this.connect.queryPages(
      {
        timezone,
        types: [...this.taskProviders.keys()],
        includeBody: true,
        frontmatterMode: "effective",
      },
      {
        firstPageSize: PAGE_SIZE,
        pageSize: PAGE_SIZE,
        signal: this.operationController.signal,
      },
    )) {
      const page = validResult(response);
      for (const record of page.results) {
        const decoded = this.readRecord(record);
        if (!decoded) continue;
        const cached = this.cache.get(decoded.task.id);
        next.set(decoded.task.id, {
          ...decoded,
          revision:
            cached && signature(cached.task) === signature(decoded.task)
              ? cached.revision
              : undefined,
        });
      }
    }

    this.cache.clear();
    for (const [id, value] of next) this.cache.set(id, value);
  }

  private async requireCurrent(
    id: string,
  ): Promise<Required<CachedMdbaseTask>> {
    const cached = this.cache.get(id);
    if (!cached) throw new Error("Task not found.");
    if (cached.revision) return cached as Required<CachedMdbaseTask>;
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
    cached: CachedMdbaseTask,
  ): Promise<Required<CachedMdbaseTask>> {
    try {
      const result = validResult(
        await this.connect.read(
          { path: cached.task.path },
          this.requestOptions(),
        ),
      );
      const decoded = this.readRecord(result);
      if (!decoded) throw new Error("The task is no longer readable.");
      const current = { ...decoded, revision: result.revision };
      if (decoded.task.id !== id) this.cache.delete(id);
      this.cache.set(decoded.task.id, current);
      return current;
    } catch (reason) {
      this.noteOperationFailure(reason);
      throw reason;
    }
  }

  private configureDescription(description: CollectionDescription): void {
    const resolved = resolveTaskCollection(description);
    if (this.collectionId && description.collectionId !== this.collectionId)
      throw new Error("The connected mdbase collection changed unexpectedly.");
    this.model = resolved.model;
    this.taskTypeName = resolved.typeName;
    this.taskProviders = new Map(
      resolved.providers.map((provider) => [provider.typeName, provider.model]),
    );
    this.displayName = description.displayName;
  }

  private async persistUpdate(
    current: Required<CachedMdbaseTask>,
    next: Task,
  ): Promise<Task> {
    const operationInput = {
      path: current.task.path,
      patch: frontmatterPatch(current.task.frontmatter, next.frontmatter),
      body: next.body,
      ifRevision: current.revision,
    };
    try {
      assertPersistableMarkdownWikilinks(operationInput.body);
      return await runMdbaseMutation(
        this.connect,
        async () =>
          this.storeResult(
            validResult(
              await this.connect.update(operationInput, this.requestOptions()),
            ),
          ),
        {
          key: mdbaseMutationKey("record:update", operationInput),
          request: this.requestOptions(),
          mapRecovered: (result: RecordDocument<JsonObject>) =>
            this.storeResult(result),
        },
      );
    } catch (reason) {
      this.noteOperationFailure(reason);
      throw reason;
    }
  }

  private async updateUnlocked(
    id: string,
    input: UpdateTaskInput,
  ): Promise<Task> {
    const current = await this.requireCurrent(id);
    const next = current.model.update(current.task, input, {
      now: new Date().toISOString(),
    });
    return this.withRollingWarnings(await this.persistUpdate(current, next));
  }

  private persistModelMutation(
    id: string,
    mutate: (task: Task, model: TaskNotesTaskModel) => Task,
  ): Promise<Task> {
    return this.serializeWrite(id, async () => {
      const current = await this.requireCurrent(id);
      return this.persistUpdate(current, mutate(current.task, current.model));
    });
  }

  private storeResult(result: RecordDocument<JsonObject>): Task {
    const decoded = this.readRecord(result);
    if (!decoded) throw new Error("The saved task could not be read.");
    this.cache.set(decoded.task.id, { ...decoded, revision: result.revision });
    this.setConnected();
    this.emit();
    return decoded.task;
  }

  private readRecord(
    record: ReadableMdbaseRecord,
  ): Omit<CachedMdbaseTask, "revision"> | null {
    const provider = this.providerForTypes(record.types ?? []);
    if (!provider) return null;
    try {
      return {
        task: provider.model.read({
          path: record.path,
          frontmatter: mdbaseFrontmatter(record),
          body: record.body ?? "",
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
    const result = await parent.model.materializeOccurrence(
      parent.task,
      occurrenceDate,
      occurrences,
      {
        id: await occurrenceRecordId(parent.task.id, occurrenceDate),
        now: new Date().toISOString(),
      },
      async (path) => {
        const template = validResult(
          await this.connect.read({ path }, this.requestOptions()),
        );
        return serializeMarkdownDocument(template.frontmatter, template.body);
      },
    );
    if (!result.created) return result;
    const created = this.reserveAvailableTaskPath(result.task);
    const operationInput = {
      path: created.path,
      type: parent.typeName,
      frontmatter: asJson(created.frontmatter),
      body: created.body,
    };
    try {
      assertPersistableMarkdownWikilinks(operationInput.body);
      const saved = await runMdbaseMutation(
        this.connect,
        async () =>
          this.storeResult(
            validResult(
              await this.connect.create(operationInput, this.requestOptions()),
            ),
          ),
        {
          key: mdbaseMutationKey("record:create", operationInput),
          request: this.requestOptions(),
          mapRecovered: (record: RecordDocument<JsonObject>) =>
            this.storeResult(record),
        },
      );
      const task = result.warnings.length
        ? { ...saved, operationWarnings: result.warnings }
        : saved;
      const cached = this.cache.get(saved.id);
      if (cached) this.cache.set(saved.id, { ...cached, task });
      return { ...result, task };
    } catch (reason) {
      try {
        const existing = validResult(
          await this.connect.read(
            { path: created.path },
            this.requestOptions(),
          ),
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
    if (cached) this.cache.set(task.id, { ...cached, task });
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
    if (cached) this.cache.set(task.id, { ...cached, task: retained });
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
      state: "connected",
      lastReachedAt: new Date().toISOString(),
    };
  }

  private setOffline(reason: unknown): void {
    this.status = {
      ...this.status,
      state: "unavailable",
      message: connectionErrorMessage(reason),
    };
  }

  private noteOperationFailure(reason: unknown): void {
    if (isConnectionFailure(reason)) {
      const message = connectionErrorMessage(reason);
      if (
        this.status.state === "unavailable" &&
        this.status.message === message
      )
        return;
      this.setOffline(reason);
      this.emit();
    }
  }

  private emit(): void {
    if (this.emitBatchDepth) {
      this.emitPending = true;
      return;
    }
    for (const listener of this.listeners) listener();
  }

  private async withBatchedEmits<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    this.emitBatchDepth += 1;
    try {
      return await operation();
    } finally {
      this.emitBatchDepth -= 1;
      if (!this.emitBatchDepth && this.emitPending) {
        this.emitPending = false;
        this.emit();
      }
    }
  }
}

function validResult<Result>(
  envelope: ConnectOutcome<Result> | MdbaseOperationEnvelope<Result>,
): Result {
  if ("ok" in envelope) return requireConnectOutcome(envelope);
  // Test doubles written for the pre-beta.23 describe() shape return the
  // description directly. Keep that narrow compatibility at this boundary.
  if (!("valid" in envelope)) return envelope as unknown as Result;
  if (!envelope.valid)
    throw new Error(
      envelope.diagnostics.map((item) => item.message).join(" ") ||
        "The collection rejected this change.",
    );
  return envelope.result;
}

function operationDiagnostics<Result>(
  envelope: ConnectOutcome<Result> | MdbaseOperationEnvelope<Result>,
): MdbaseDiagnostic[] {
  if ("ok" in envelope) return envelope.ok ? envelope.diagnostics : [];
  return envelope.diagnostics;
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

function mdbaseFrontmatter(record: ReadableMdbaseRecord): JsonObject {
  return record.effectiveFrontmatter ?? record.frontmatter ?? {};
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

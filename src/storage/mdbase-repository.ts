import { Capacitor } from "@capacitor/core";
import { MdbaseViewAdapter } from "./mdbase-view-adapter";
import { validResult, operationDiagnostics } from "./mdbase-operation";
import { taskCompletion } from "../domain/task-completion";
import { materializeRollingWindow } from "../application/rolling-occurrences";
import {
  DEFAULT_TASK_QUERY_LIMIT,
  taskSearchTokens,
} from "../domain/task-query";
import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import { patchTaskNotesMdbaseTypeSettings } from "@tasknotes/model/mdbase";
import {
  linksTo,
  type CollectionDescription,
  type JsonObject,
  type MdbaseConnection,
  type RecordDocument,
} from "@mdbase-dev/connect";

import { connectProblemFromError } from "../cloud/outcome";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { archiveMoveWarning } from "../domain/task-archive";
import { runtimeTimezone } from "../domain/runtime-timezone";
import type { ReminderTimerAuthority } from "./reminder-timers";
import { desiredTaskTimers } from "../domain/reminder-timers";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";
import {
  findOccurrenceParent,
  findMaterializedOccurrenceTask,
  occurrenceRecordId,
} from "../domain/task-occurrence";
import {
  connectedTaskRelationships,
  sameConnectedTaskMetadata,
  connectedTaskStats,
} from "./connected-task-cache";
import { ConnectedTaskIndex } from "./connected-task-index";
import { TaskDocumentCache } from "./task-document-cache";
import { changedRecordPaths } from "./mdbase-change-plan";
import {
  mdbaseMutationKey,
  runMdbaseMutation,
  unknownOutcomeRequestId,
} from "./mdbase-mutation-coordinator";
import { MdbaseCollectionFileStore } from "./mdbase-files";
import { readPeopleDirectory } from "./mdbase-people";
import {
  activeScratchpads,
  assertScratchpadRebase,
  assertScratchpadRevision,
  newScratchpadValues,
  scratchpadFromRecord,
  scratchpadFrontmatter,
  type ScratchpadRecordLike,
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
  type ReactivateScratchpadInput,
  type SaveScratchpadInput,
  type ScratchpadPageRequest,
  type ScratchpadReference,
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

import type {
  CreateTaskInput,
  MaterializeOccurrenceResult,
  Task,
  TaskSummary,
  TaskSearchResult,
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
  UpdateTaskViewSourceInput,
} from "../domain/view";
import type {
  CollectionInfo,
  RefreshResult,
  RepositoryConnectionStatus,
  RepositoryChange,
  TaskCreateIntent,
  TaskRepository,
} from "../application/ports/task-repository";

interface CachedMdbaseTask {
  task: TaskSummary;
  revision?: string;
  model: TaskNotesTaskModel;
  typeName: string;
}

interface CachedTaskDocument extends CachedMdbaseTask {
  task: Task;
}
type CurrentTaskDocument = CachedTaskDocument & { revision: string };

interface ReadableMdbaseRecord {
  path: string;
  revision?: string;
  frontmatter?: JsonObject;
  effectiveFrontmatter?: JsonObject;
  body?: string;
  types?: string[];
}

const PAGE_SIZE = 1_000;
// Match the selected connection coordinator's foreground read slots.
const RECORD_READ_CONCURRENCY = 4;

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
  private readonly cache = new ConnectedTaskIndex<CachedMdbaseTask>();
  private readonly documents = new TaskDocumentCache<CachedTaskDocument>();
  private changeCursor?: number;
  private descriptionSignature?: string;
  private description?: CollectionDescription;
  private readonly views: MdbaseViewAdapter;
  private collectionId = "";
  private readonly listeners = new Set<(change?: RepositoryChange) => void>();
  private readonly writeTails = new Map<string, Promise<void>>();
  private emitBatchDepth = 0;
  private emitPending = false;
  private readonly reservedTaskPaths = new Set<string>();
  private readonly acceptedCreates = new WeakMap<TaskCreateIntent, Task>();
  private readonly revisionReads = new Map<
    string,
    Promise<CurrentTaskDocument>
  >();
  private reminderReconciliation?: {
    signal: AbortSignal;
    requested: number;
    promise: Promise<void>;
  };
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

  constructor(
    private readonly connect: MdbaseConnection<JsonObject>,
    private readonly options: {
      /** mdbase-next: reconcile opaque timers with the control plane's timer service. */
      reminderTimers?: ReminderTimerAuthority;
    } = {},
  ) {
    this.views = new MdbaseViewAdapter(
      connect,
      () => this.requestOptions(),
      (record) => this.readViewSummary(record),
      (reason) => this.noteOperationFailure(reason),
    );
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
      this.revisionReads.clear();
      this.taskIndexLoading = undefined;
      // A lifecycle interruption can abort the first initialization attempt
      // (including React Strict Mode's development remount). Do not retain that
      // rejected promise: the resumed owner must be able to open the same
      // repository with the fresh lifecycle signal.
      this.initialization = null;
      this.completeInitialization = undefined;
      this.refreshInFlight = null;
      this.emit({ kind: "lifecycle" });
    }
  }

  dispose(): void {
    this.documents.clear();
    this.operationController.abort(
      new DOMException("The TaskNotes collection changed.", "AbortError"),
    );
  }

  private completeInitialization?: Promise<void>;
  private taskIndexReady = false;
  private taskIndexPreviouslyReady = false;
  private taskIndexLoading?: Promise<void>;
  private readonly viewTaskHints = new Map<string, CachedMdbaseTask>();

  async initialize(options: { deferTaskIndex?: boolean } = {}): Promise<void> {
    if (!this.initialization) {
      const signal = this.operationController.signal;
      const opening = this.initializeUnlocked().catch((reason: unknown) => {
        if (this.initialization === opening) this.initialization = null;
        if (!signal.aborted) this.noteOperationFailure(reason);
        throw reason;
      });
      this.initialization = opening;
    }
    await this.initialization;
    if (!options.deferTaskIndex) {
      if (!this.completeInitialization) {
        const complete = (async () => {
          await this.ensureTaskIndex();
          await this.maintainRollingOccurrencesUnlocked();
          this.emit();
        })().catch((reason: unknown) => {
          if (this.completeInitialization === complete)
            this.completeInitialization = undefined;
          throw reason;
        });
        this.completeInitialization = complete;
      }
      await this.completeInitialization;
    }
  }

  private async ensureTaskIndex(): Promise<void> {
    if (this.taskIndexReady) return;
    if (this.taskIndexLoading) return this.taskIndexLoading;
    const signal = this.operationController.signal;
    const loading = (async () => {
      await this.initialize({ deferTaskIndex: true });
      signal.throwIfAborted();
      await this.reloadCache(undefined, signal);
      signal.throwIfAborted();
      this.taskIndexReady = true;
      this.setConnected();
      if (this.taskIndexPreviouslyReady) this.emit();
      this.taskIndexPreviouslyReady = true;
    })()
      .catch((reason: unknown) => {
        if (!signal.aborted) this.noteOperationFailure(reason);
        throw reason;
      })
      .finally(() => {
        if (this.taskIndexLoading === loading)
          this.taskIndexLoading = undefined;
      });
    this.taskIndexLoading = loading;
    return loading;
  }

  private async ensureKnownTask(id: string): Promise<void> {
    if (this.cache.has(id)) return;
    const hint = this.viewTaskHints.get(id);
    if (hint) {
      this.cache.set(id, hint);
      this.viewTaskHints.delete(id);
    } else await this.ensureTaskIndex();
  }

  private readViewSummary(record: ReadableMdbaseRecord): TaskSummary | null {
    const decoded = this.readSummary(record);
    if (!decoded) return null;
    if (!this.cache.has(decoded.task.id)) {
      this.viewTaskHints.delete(decoded.task.id);
      this.viewTaskHints.set(decoded.task.id, decoded);
      if (this.viewTaskHints.size > 512)
        this.viewTaskHints.delete(this.viewTaskHints.keys().next().value!);
    }
    return decoded.task;
  }

  private async initializeUnlocked(): Promise<void> {
    const signal = this.operationController.signal;
    const description = validResult(await this.connect.describe({ signal }));
    signal.throwIfAborted();
    if (this.configureDescription(description)) this.taskIndexReady = false;
    this.collectionId = description.collectionId;
    if (!this.taskIndexReady)
      this.changeCursor = description.operations.includes("changes")
        ? description.changeCursor
        : undefined;
    this.setConnected();
  }

  refresh(): Promise<RefreshResult> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const run = this.refreshUnlocked().finally(() => {
      if (this.refreshInFlight === run) this.refreshInFlight = null;
    });
    this.refreshInFlight = run;
    return run;
  }

  private async refreshUnlocked(): Promise<RefreshResult> {
    const startedAt = performance.now();
    const signal = this.operationController.signal;
    let result = { scanned: 0, changed: 0, removed: 0 };
    let invalidate = false;
    // Refreshing a known collection is not a loss of connectivity. Preserve
    // its last known availability until the authority succeeds or fails.
    try {
      const indexWasReady = this.taskIndexReady;
      let description = validResult(
        await this.connect.describe({
          signal,
          // A failed/unloaded index must be able to rediscover its decoding schema.
          fresh: !this.taskIndexReady,
        }),
      );
      // Let an existing snapshot settle before changing its decoding models.
      // A failed initial load must not prevent refresh from discovering a new schema.
      await this.taskIndexLoading?.catch(() => undefined);
      signal.throwIfAborted();
      let configurationChanged = this.configureDescription(description);
      await this.ensureTaskIndex();
      signal.throwIfAborted();
      // Initial metadata loading already supplied a full snapshot. Older
      // authorities without changes must not download it a second time here.
      const generation = this.connect.schemaGeneration;
      let plan =
        !indexWasReady &&
        !configurationChanged &&
        !description.operations.includes("changes")
          ? { paths: new Set<string>(), cursor: undefined, invalidate: false }
          : await this.refreshPlan(description, configurationChanged, signal);
      // changes() invalidates the SDK description before returning schema/gap
      // events. Refresh decoding models before consuming their replacement rows.
      if (
        this.connect.schemaGeneration !== generation ||
        (!plan.paths && !configurationChanged)
      ) {
        description = validResult(
          await this.connect.describe({
            signal,
            fresh: !plan.paths,
          }),
        );
        signal.throwIfAborted();
        configurationChanged =
          this.configureDescription(description) || configurationChanged;
        if (configurationChanged || !plan.paths)
          plan = {
            cursor: description.operations.includes("changes")
              ? description.changeCursor
              : undefined,
            invalidate: true,
          };
      }
      signal.throwIfAborted();
      result = await this.reloadCache(plan.paths, signal);
      // Advance only after all pages have been read and committed successfully.
      this.changeCursor = plan.cursor;
      invalidate =
        plan.invalidate ||
        configurationChanged ||
        result.changed > 0 ||
        result.removed > 0;
      if (invalidate) this.scratchFeedSnapshot = undefined;
      this.setConnected();
      await this.maintainRollingOccurrencesUnlocked();
    } catch (reason) {
      // Lifecycle cancellation says nothing about authority availability.
      if (!signal.aborted) this.noteOperationFailure(reason);
    }
    if (!signal.aborted) this.emit({ kind: invalidate ? "data" : "status" });
    return { ...result, elapsedMs: Math.round(performance.now() - startedAt) };
  }

  reconcileReminders(): Promise<void> {
    const signal = this.operationController.signal;
    const active = this.reminderReconciliation;
    if (active?.signal === signal) {
      active.requested++;
      return active.promise;
    }
    const scope = { signal, requested: 1, promise: Promise.resolve() };
    scope.promise = (async () => {
      let completed = 0;
      while (completed < scope.requested) {
        signal.throwIfAborted();
        const target = scope.requested;
        const tasks = await this.listSummaries({
          status: "open",
          limit: 50_000,
        });
        signal.throwIfAborted();
        const operationInput = {
          namespace: "task-reminders",
          criterionId: "task.reminder",
          timers: await desiredTaskTimers(tasks),
        };
        signal.throwIfAborted();
        const request = {
          signal,
          timeoutMs: TASKNOTES_REQUEST_BUDGETS.backgroundMs,
        };
        const reminderTimers = this.options.reminderTimers;
        if (reminderTimers) {
          // The timer service is outside the collection: no record mutation
          // to coordinate, and it works while no replica is online.
          await reminderTimers.reconcile(operationInput, request);
          signal.throwIfAborted();
          completed = target;
          continue;
        }
        await runMdbaseMutation(
          this.connect,
          async () => {
            // The coordinator may have waited behind an active task write.
            signal.throwIfAborted();
            validResult(
              await this.connect.reconcileTimers(operationInput, request),
            );
          },
          {
            key: mdbaseMutationKey("timers:reconcile", operationInput),
            mapRecovered: () => {
              signal.throwIfAborted();
            },
            request,
          },
        );
        signal.throwIfAborted();
        completed = target;
      }
    })().finally(() => {
      if (this.reminderReconciliation === scope)
        this.reminderReconciliation = undefined;
    });
    this.reminderReconciliation = scope;
    return scope.promise;
  }

  people(signal?: AbortSignal) {
    return readPeopleDirectory(this.connect, signal);
  }

  async listSummaries(
    query: Omit<TaskListQuery, "search"> = {},
  ): Promise<TaskSummary[]> {
    if (query.limit === 0) return [];
    await this.ensureTaskIndex();
    const { status, archived, limit } = query;
    return this.cache.list(
      { status, archived, limit },
      undefined,
      await this.assignedPathsFor(query),
    );
  }

  /** Paths for `assignedTo`, resolved by mdbase; undefined when unfiltered. */
  private async assignedPathsFor(
    query: Pick<TaskListQuery, "assignedTo">,
  ): Promise<ReadonlySet<string> | undefined> {
    return query.assignedTo === undefined
      ? undefined
      : this.assignedTaskPaths(query.assignedTo);
  }

  /** Asks mdbase which tasks' assignee links resolve to the person record. */
  private async assignedTaskPaths(personPath: string): Promise<Set<string>> {
    const paths = new Set<string>();
    for (const [typeName, model] of this.taskProviders) {
      for await (const response of this.connect.queryPages(
        {
          types: [typeName],
          where: linksTo(model.config.fieldMapping.assignees, personPath, {
            multiple: true,
          }),
        },
        { pageSize: PAGE_SIZE, signal: this.operationController.signal },
      )) {
        for (const record of validResult(response).results)
          paths.add(record.path);
      }
    }
    return paths;
  }

  async resolveAssignees(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<Map<string, string | null>> {
    const cached = this.cache.get(taskId);
    if (!cached) throw new Error("The task is no longer available.");
    const field = JSON.stringify(cached.model.config.fieldMapping.assignees);
    const result = validResult(
      await this.connect.query(
        {
          types: [cached.typeName],
          where: `file.path == ${JSON.stringify(cached.task.path)}`,
          projections: {
            // Persisted link text, index-aligned with the resolved targets.
            links: { expression: `${field} in raw ? raw[${field}] : []` },
            targets: {
              expression: `${field} in record ? record[${field}].map(a, a.asFile() == null ? null : a.asFile().file.path) : []`,
            },
          },
          select: ["projection.links", "projection.targets"],
        },
        { signal },
      ),
    );
    const values = result.results[0]?.values;
    const links = Array.isArray(values?.links) ? values.links : [];
    const targets = Array.isArray(values?.targets) ? values.targets : [];
    return new Map(
      links.map((link, index) => [
        String(link),
        typeof targets[index] === "string" ? (targets[index] as string) : null,
      ]),
    );
  }

  async list(
    query: TaskListQuery = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<Task[]> {
    const signal = options.signal
      ? AbortSignal.any([this.operationController.signal, options.signal])
      : this.operationController.signal;
    signal.throwIfAborted();
    if (query.limit === 0) return [];
    await this.ensureTaskIndex();
    signal.throwIfAborted();
    const selected = query.search?.trim()
      ? (await this.search(query, { signal })).map((result) => result.task)
      : this.cache.list(query, undefined, await this.assignedPathsFor(query));
    return this.hydrateTasks(selected, signal);
  }

  async search(
    query: TaskListQuery,
    options: { signal?: AbortSignal } = {},
  ): Promise<TaskSearchResult[]> {
    const limit = query.limit ?? DEFAULT_TASK_QUERY_LIMIT;
    const target = limit < 0 ? Infinity : Math.max(0, Math.trunc(limit));
    if (target === 0 || Number.isNaN(target)) return [];
    const signal = options.signal
      ? AbortSignal.any([this.operationController.signal, options.signal])
      : this.operationController.signal;
    signal.throwIfAborted();
    await this.ensureTaskIndex();
    signal.throwIfAborted();
    const tokens = taskSearchTokens(query.search);
    const assigned = await this.assignedPathsFor(query);
    signal.throwIfAborted();
    if (!tokens.length)
      return this.cache
        .list(query, undefined, assigned)
        .map((task) => ({ task, bodyMatches: [] }));
    const candidates = this.cache.list(
      { ...query, search: undefined, limit: Number.MAX_SAFE_INTEGER },
      undefined,
      assigned,
    );
    const observed = new Map<string, string[]>();
    const selected: TaskSearchResult[] = [];
    let position = 0;
    let yieldAt = performance.now() + 8;
    const checkpoint = async () => {
      signal.throwIfAborted();
      if (performance.now() < yieldAt) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal.throwIfAborted();
      yieldAt = performance.now() + 8;
    };
    // Stop early only when every earlier candidate is known, preserving the
    // app's ordering even if the provider returns body matches in another order.
    const consume = async (complete: boolean): Promise<boolean> => {
      while (position < candidates.length) {
        const task = candidates[position];
        const bodyMatches = observed.get(task.path);
        const missing = tokens.filter(
          (token) => !this.cache.matchesMetadata(task, token),
        );
        if (missing.length && bodyMatches === undefined && !complete)
          return false;
        if (missing.every((token) => bodyMatches?.includes(token)))
          selected.push({ task, bodyMatches: bodyMatches ?? [] });
        position++;
        if (selected.length >= target) return true;
        if (position % 128 === 0) await checkpoint();
      }
      return true;
    };
    if (await consume(false)) return selected.slice(0, limit);
    const expressions = tokens.map(
      (token) => `file.body.lower().contains(${JSON.stringify(token)})`,
    );
    // A token absent from every candidate's metadata MUST occur in its body.
    // This avoids transferring all records for "ordinary notes rare-needle",
    // without depending on provider field mappings.
    const metadataTokens = new Set<string>();
    for (let index = 0; index < candidates.length; index++) {
      for (const token of tokens) {
        if (
          !metadataTokens.has(token) &&
          this.cache.matchesMetadata(candidates[index], token)
        )
          metadataTokens.add(token);
      }
      if (metadataTokens.size === tokens.length) break;
      if (index % 128 === 0) await checkpoint();
    }
    const required = expressions.filter(
      (_, index) => !metadataTokens.has(tokens[index]),
    );
    const where = (required.length ? required : expressions).join(
      required.length ? " && " : " || ",
    );
    try {
      for await (const outcome of this.connect.queryPages(
        {
          types: [...this.taskProviders.keys()],
          timezone: runtimeTimezone(),
          where,
          includeBody: false,
          projections: Object.fromEntries(
            expressions.map((expression, index) => [
              `tasknotes_body_${index}`,
              { expression },
            ]),
          ),
          select: [
            "file.path",
            ...expressions.map(
              (_, index) => `projection.tasknotes_body_${index}`,
            ),
          ],
          orderBy: [{ field: "file.path", direction: "asc" }],
        },
        { firstPageSize: PAGE_SIZE, pageSize: PAGE_SIZE, signal },
      )) {
        signal.throwIfAborted();
        if (
          operationDiagnostics(outcome).some(
            (diagnostic) =>
              diagnostic.severity === "error" ||
              diagnostic.code === "expression_evaluation_error",
          )
        )
          throw new Error(
            "The authority could not evaluate this search completely.",
          );
        for (const record of validResult(outcome).results) {
          const values = (
            record as typeof record & { values?: Record<string, unknown> }
          ).values;
          const matches = tokens.filter((token, index) => {
            void token;
            const match = values?.[`tasknotes_body_${index}`];
            if (typeof match !== "boolean")
              throw new Error(
                "The authority returned incomplete search match evidence.",
              );
            return match;
          });
          observed.set(record.path, matches);
        }
        if (await consume(false)) return selected.slice(0, limit);
      }
      await consume(true);
      return selected.slice(0, limit);
    } catch (reason) {
      if (!signal.aborted) this.noteOperationFailure(reason);
      throw reason;
    }
  }

  async getSummary(id: string): Promise<TaskSummary | null> {
    const cached = this.cache.get(id);
    if (cached && cached.model !== this.taskProviders.get(cached.typeName))
      await this.ensureTaskIndex();
    if (!this.cache.has(id)) await this.ensureKnownTask(id);
    return this.cache.get(id)?.task ?? null;
  }

  async get(id: string): Promise<Task | null> {
    if (!this.cache.has(id)) await this.ensureKnownTask(id);
    if (!this.cache.has(id)) return null;
    const document = this.documents.get(id);
    if (
      document &&
      document.model === this.taskProviders.get(document.typeName)
    )
      return document.task;
    try {
      return (await this.requireCurrent(id)).task;
    } catch (reason) {
      if (!this.cache.has(id)) return null;
      throw reason;
    }
  }

  async relationships(id: string) {
    await this.ensureTaskIndex();
    return connectedTaskRelationships(this.cache.values(), id);
  }

  async completeField(
    request: FieldCompletionRequest,
  ): Promise<FieldCompletion[]> {
    await this.ensureTaskIndex();
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
                // Standard CEL has no note namespace, and a missing title must
                // not fail the whole filter for that record.
                `(has(record.title) && record.title.lower().contains(${JSON.stringify(query)}))`,
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
    const taskIdsByPath = new Map(
      [...this.cache.values()].map(({ task }) => [
        task.path.toLocaleLowerCase(),
        task.id,
      ]),
    );
    return completeRecords(
      records,
      request,
      this.model.configuration().linkWriteFormat,
    ).map((completion) => {
      const taskId = completion.path
        ? taskIdsByPath.get(completion.path.toLocaleLowerCase())
        : undefined;
      return taskId ? { ...completion, taskId } : completion;
    });
  }

  create(
    input: CreateTaskInput,
    intent: TaskCreateIntent = { id: crypto.randomUUID() },
  ): Promise<Task> {
    return this.serializeWrite(intent.id, async () => {
      // Recovery may have completed during a refresh/recovery review. Reconnect
      // that receipt to its capture instead of issuing another create.
      const accepted = this.acceptedCreates.get(intent);
      if (accepted) return accepted;
      const accept = (result: RecordDocument<JsonObject>) => {
        const task = this.storeResult(result);
        this.acceptedCreates.set(intent, task);
        return task;
      };
      try {
        const saved = await runMdbaseMutation(
          this.connect,
          async () => {
            // Generated record identity belongs to this operation, not to each
            // retry. The coordinator recovers the intent before preparing it.
            await this.ensureTaskIndex();
            const created = await this.model.createWithTemplate(
              input,
              { id: crypto.randomUUID(), now: new Date().toISOString() },
              async (path) => {
                const template = validResult(
                  await this.connect.read({ path }, this.requestOptions()),
                );
                return serializeMarkdownDocument(
                  template.frontmatter,
                  template.body,
                );
              },
            );
            const task = this.reserveAvailableTaskPath(created);
            try {
              return accept(
                validResult(
                  await this.connect.create(
                    {
                      path: task.path,
                      type: this.taskTypeName,
                      frontmatter: asJson(task.frontmatter),
                      body: task.body,
                    },
                    this.requestOptions(),
                  ),
                ),
              );
            } catch (reason) {
              const requestId = unknownOutcomeRequestId(reason);
              if (requestId) intent.authorityRequestId = requestId;
              throw reason;
            } finally {
              this.reservedTaskPaths.delete(task.path);
            }
          },
          {
            key: mdbaseMutationKey("task:create-intent", intent.id),
            requestId: intent.authorityRequestId,
            request: this.requestOptions(),
            mapRecovered: accept,
          },
        );
        const task = await this.withRollingWarnings(saved);
        this.acceptedCreates.set(intent, task);
        return task;
      } catch (reason) {
        this.noteOperationFailure(reason);
        throw reason;
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

  async toggle(
    id: string,
    occurrenceDate?: string,
    completed?: boolean,
  ): Promise<Task> {
    await this.ensureKnownTask(id);
    if (this.cache.get(id)?.task.recurrenceParent) await this.ensureTaskIndex();
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
        this.transitionMaterializedUnlocked(id, parent.id, "toggle", completed),
      );
    }
    return this.serializeWrite(id, async () => {
      const current = await this.requireCurrent(id, completed !== undefined);
      if (
        completed !== undefined &&
        taskCompletion(current.task, occurrenceDate) === completed
      ) {
        this.emit();
        return current.task;
      }
      const next = current.model.toggle(current.task, {
        now: new Date().toISOString(),
        currentDate: occurrenceDate,
      });
      return this.persistUpdate(current, next);
    });
  }

  async skip(id: string, occurrenceDate: string): Promise<Task> {
    await this.ensureKnownTask(id);
    if (this.cache.get(id)?.task.recurrenceParent) await this.ensureTaskIndex();
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
        if (saved) this.storeDocument({ ...saved, task: retained });
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
      const applyDeleted = () => {
        this.cache.delete(id);
        this.documents.delete(id);
        this.setConnected();
        this.emit();
      };
      try {
        // Exact receipts remain authoritative even when the deleted document
        // (or its summary) is gone. Never use file absence as acceptance.
        if (options.authorityRequestId) {
          await runMdbaseMutation(
            this.connect,
            async () => {
              throw new Error(
                "Exact deletion recovery must not replay a delete.",
              );
            },
            {
              key: mdbaseMutationKey("task:delete-recovery", id),
              requestId: options.authorityRequestId,
              request: this.requestOptions(),
              mapRecovered: applyDeleted,
            },
          );
          return;
        }
        await this.ensureKnownTask(id);
        if (!this.cache.get(id)) return;
        const current = await this.requireCurrent(id);
        const operationInput = {
          path: current.task.path,
          ifRevision: current.revision,
          check_backlinks: true,
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
          },
        );
      } catch (reason) {
        this.noteOperationFailure(reason);
        throw reason;
      }
    });
  }

  async stats(): Promise<TaskStats> {
    await this.ensureTaskIndex();
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
      this.documents.clear();
      this.viewTaskHints.clear();
      this.views.invalidate();
      this.completionCache.clear();
      // Settings change effective frontmatter too, not only the local model.
      // Requery metadata without materializing inherited defaults into files.
      this.taskIndexReady = false;
      this.description = undefined;
      this.descriptionSignature = undefined;
      this.changeCursor = undefined;
      return this.model.configuration();
    };
    try {
      const configuration = await runMdbaseMutation(
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
      // A scan begun under the old schema must not certify a ready index.
      await this.taskIndexLoading;
      this.taskIndexReady = false;
      const previouslyReady = this.taskIndexPreviouslyReady;
      await this.ensureTaskIndex();
      if (!previouslyReady) this.emit();
      return configuration;
    } catch (reason) {
      this.noteOperationFailure(reason);
      throw reason;
    }
  }

  listViews = () => this.views.listViews();
  cachedViews = () => this.views.cachedViews();
  cachedViewExecution = (view: TaskView) =>
    this.views.cachedViewExecution(view);
  iterateView = (
    view: TaskView,
    options: { signal?: AbortSignal; cumulative?: boolean } = {},
  ) => this.views.iterateView(view, options);
  executeView = (view: TaskView) => this.views.executeView(view);
  readViewSource = (path: string) => this.views.readViewSource(path);
  createViewSource = (input: CreateTaskViewSourceInput) =>
    this.views.createViewSource(input);
  updateViewSource = (input: UpdateTaskViewSourceInput) =>
    this.views.updateViewSource(input);
  deleteViewSource = (path: string, ifRevision?: string) =>
    this.views.deleteViewSource(path, ifRevision);

  listScratchFeed(request: ScratchFeedPageRequest = {}) {
    return this.serializeWrite("scratchpad:active", async () => {
      if (!request.cursor || !this.scratchFeedSnapshot) {
        const current = await this.ensureActiveScratchpad();
        const scratchRecords = await this.scratchpadRecords();
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
      await this.ensureActiveScratchpad();
      return scratchpadPage(
        (await this.scratchpadRecords()).map(scratchpadFromRecord),
        request,
      );
    });
  }

  async getScratchpad(id: string) {
    const record = (await this.scratchpadRecords()).find(
      (candidate) => candidate.frontmatter.id === id,
    );
    return record ? scratchpadFromRecord(record) : null;
  }

  getActiveScratchpad() {
    return this.serializeWrite("scratchpad:active", () =>
      this.ensureActiveScratchpad(),
    );
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
        const current = await this.ensureActiveScratchpad();
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
        // Another window may already have created the replacement in the gap.
        const active = await this.ensureActiveScratchpad();
        this.setConnected();
        this.scratchFeedSnapshot = undefined;
        this.emit();
        return { previous: scratchpadFromRecord(previous), current: active };
      },
    );
  }

  reactivateScratchpad(input: ReactivateScratchpadInput) {
    return this.serializeWrites(
      [
        "scratchpad:active",
        `scratchpad:${input.current.id}`,
        `scratchpad:${input.target.id}`,
      ],
      async () => {
        if (input.current.id === input.target.id)
          throw new Error("The current scratchpad cannot resume itself.");
        const current = await this.ensureActiveScratchpad();
        const target = scratchpadFromRecord(
          await this.requireScratchpadRecord(
            input.target.id,
            input.target.path,
          ),
        );
        assertScratchpadRevision(current, input.current);
        assertScratchpadRevision(target, input.target);
        if (target.state !== "converted")
          throw new Error("Only a previous scratchpad can be resumed.");

        const now = new Date().toISOString();
        const promoted = await this.mutateRecord("scratchpad:reactivate", {
          path: target.path,
          ifRevision: target.revision,
          patch: asJson({ state: "active", dateModified: now }),
        });
        // Promote first: interruption leaves duplicates that opening the
        // stream can repair, rather than losing the intended current note.
        const previousRecord = await this.mutateRecord(
          "scratchpad:deactivate-current",
          {
            path: current.path,
            ifRevision: current.revision,
            patch: asJson({
              state: "converted",
              dateModified: now,
              dateConverted: now,
            }),
          },
        );
        this.setConnected();
        this.scratchFeedSnapshot = undefined;
        this.emit();
        return {
          previous: scratchpadFromRecord(previousRecord),
          current: scratchpadFromRecord(promoted),
        };
      },
    );
  }

  deleteScratchpad(input: ScratchpadReference) {
    return this.serializeWrites(
      ["scratchpad:active", `scratchpad:${input.id}`],
      async () => {
        const current = scratchpadFromRecord(
          await this.requireScratchpadRecord(input.id, input.path),
        );
        if (current.revision !== input.revision)
          throw new Error(
            "This note changed after it was opened. Reload it before deleting.",
          );
        // Deleting the current note would leave the stream without one.
        if (current.state !== "converted")
          throw new Error("Only a previous note can be deleted.");
        const operationInput = {
          path: current.path,
          ifRevision: current.revision,
        };
        await runMdbaseMutation(
          this.connect,
          async () => {
            validResult(
              await this.connect.delete(operationInput, this.requestOptions()),
            );
          },
          {
            key: mdbaseMutationKey("scratchpad:delete", operationInput),
            mapRecovered: () => undefined,
            request: this.requestOptions(),
          },
        );
        this.setConnected();
        this.scratchFeedSnapshot = undefined;
        this.emit();
      },
    );
  }

  async archiveScratchpad(input: ArchiveScratchpadInput) {
    const result = await this.startNewScratchpad(input);
    return { archived: result.previous, active: result.current };
  }

  private async scratchImageRecords(): Promise<ScratchpadRecordLike[]> {
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
    return this.readRecordsBounded(result.results);
  }

  private async ensureActiveScratchpad() {
    for (let attempt = 0; attempt < 5; attempt++) {
      let active = activeScratchpads(await this.activeScratchpadRecords());
      if (!active.length) {
        const created = await this.createActiveScratchpad();
        active = activeScratchpads(await this.activeScratchpadRecords());
        if (!active.length) return created;
      }
      const [current, ...duplicates] = active;
      try {
        for (const duplicate of duplicates) {
          await this.mutateRecord("scratchpad:repair-duplicate", {
            path: duplicate.path,
            ifRevision: duplicate.revision,
            // Only lifecycle metadata changes; preserve exact note contents.
            patch: asJson({
              state: "converted",
              dateConverted: new Date().toISOString(),
            }),
          });
        }
        if (duplicates.length) this.scratchFeedSnapshot = undefined;
        return current;
      } catch (reason) {
        // A real edit may change the winner. Never demote using a stale read.
        if (connectProblemFromError(reason)?.code !== "concurrent_modification")
          throw reason;
      }
    }
    throw new Error(
      "The current note is changing in another window. Reload before continuing.",
    );
  }

  private async activeScratchpadRecords(): Promise<
    RecordDocument<JsonObject>[]
  > {
    const narrowed = await this.queryActiveScratchpadRecords(
      'record.state == "active"',
    );
    // An authority that cannot evaluate the filter reports each record as a
    // warning and returns none of them. That is not an empty collection:
    // select from every note instead, so a missing current note is never
    // inferred from a query the authority did not complete.
    return narrowed ?? (await this.queryActiveScratchpadRecords()) ?? [];
  }

  /** Returns undefined when the authority could not evaluate the filter. */
  private async queryActiveScratchpadRecords(
    where?: string,
  ): Promise<RecordDocument<JsonObject>[] | undefined> {
    const records: RecordDocument<JsonObject>[] = [];
    for await (const outcome of this.connect.queryPages(
      {
        timezone: runtimeTimezone(),
        types: [SCRATCHPAD_TYPE],
        ...(where ? { where } : {}),
        includeBody: false,
        frontmatterMode: "persisted",
      },
      this.requestOptions(),
    )) {
      if (
        where &&
        operationDiagnostics(outcome).some(
          (diagnostic) => diagnostic.code === "expression_evaluation_error",
        )
      )
        return undefined;
      for (const candidate of validResult(outcome).results) {
        // Test doubles and some providers may not apply the query filter.
        if (mdbaseFrontmatter(candidate).state !== "active") continue;
        records.push(
          validResult(
            await this.connect.read(
              { path: candidate.path },
              this.requestOptions(),
            ),
          ),
        );
      }
    }
    return records;
  }

  private async createActiveScratchpad() {
    const values = newScratchpadValues();
    const operationInput = {
      ...values,
      type: SCRATCHPAD_TYPE,
      frontmatter: asJson(values.frontmatter),
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

  /** History needs paired content/revisions, not exact Markdown documents.
   * Old authorities retain the four-slot point-read path; advertised batch
   * failures must surface rather than trigger an error-based downgrade.
   */
  private async readRecordsBounded(
    candidates: readonly { path: string }[],
  ): Promise<ScratchpadRecordLike[]> {
    const options = this.requestOptions();
    if (!candidates.length) return [];
    if (
      validResult(
        await this.connect.supportsAuthorityFeature(
          "read-many-documents-v1",
          options,
        ),
      )
    ) {
      const batch = validResult(
        await this.connect.readMany(
          candidates.map(({ path }) => path),
          {
            ...options,
            includeBody: true,
            frontmatterMode: "persisted",
            batchSize: 100,
            concurrency: RECORD_READ_CONCURRENCY,
          },
        ),
      );
      options.signal.throwIfAborted();
      for (const error of batch.errors) validResult(error.failure);
      return batch.results.map((entry) => {
        if (entry.status !== "found")
          throw new Error(
            `The scratchpad record is no longer available: ${entry.path}`,
          );
        const { path, frontmatter, body, types, revision } = entry.record;
        if (!revision || !frontmatter || typeof body !== "string")
          throw new Error(
            "The authority did not return complete scratchpad content and revision.",
          );
        return { path, frontmatter, body, types, revision };
      });
    }
    const records: ScratchpadRecordLike[] = [];
    for (
      let offset = 0;
      offset < candidates.length;
      offset += RECORD_READ_CONCURRENCY
    ) {
      options.signal.throwIfAborted();
      records.push(
        ...(await Promise.all(
          candidates
            .slice(offset, offset + RECORD_READ_CONCURRENCY)
            .map(async ({ path }) =>
              validResult(await this.connect.read({ path }, options)),
            ),
        )),
      );
    }
    options.signal.throwIfAborted();
    return records;
  }

  private async scratchpadRecords(): Promise<ScratchpadRecordLike[]> {
    const records: ScratchpadRecordLike[] = [];
    for await (const outcome of this.connect.queryPages(
      {
        timezone: runtimeTimezone(),
        types: [SCRATCHPAD_TYPE],
        includeBody: false,
        frontmatterMode: "persisted",
      },
      this.requestOptions(),
    )) {
      records.push(
        ...(await this.readRecordsBounded(validResult(outcome).results)),
      );
    }
    return records;
  }

  private async requireScratchpadRecord(
    id: string,
    path?: string,
  ): Promise<ScratchpadRecordLike> {
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

  private mutateRecord(
    operation: string,
    input: Parameters<MdbaseConnection<JsonObject>["update"]>[0],
  ): Promise<RecordDocument<JsonObject>> {
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

  subscribe(listener: (change?: RepositoryChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private requestOptions(): { signal: AbortSignal } {
    return { signal: this.operationController.signal };
  }

  private async refreshPlan(
    description: CollectionDescription,
    configurationChanged: boolean,
    signal: AbortSignal,
  ): Promise<{
    paths?: Set<string>;
    cursor?: number;
    invalidate: boolean;
  }> {
    const supportsChanges = description.operations.includes("changes");
    const full = {
      cursor: supportsChanges ? description.changeCursor : undefined,
      invalidate: true,
    };
    if (
      !supportsChanges ||
      this.changeCursor === undefined ||
      configurationChanged
    )
      return full;
    let cursor = this.changeCursor;
    const paths = new Set<string>();
    let invalidate = false;
    // Bound catch-up work. A reset, schema event, or large backlog replaces the
    // snapshot rather than issuing thousands of individual record requests.
    for (let page = 0; page < 10; page++) {
      const outcome = await this.connect.changes(
        { after: cursor, limit: 1000 },
        { signal },
      );
      signal.throwIfAborted();
      if (!outcome.ok && outcome.problem.code === "change_cursor_reset")
        return full;
      const changes = validResult(outcome);
      if (changes.reset || changes.cursor < cursor) return full;
      const changedPaths = changedRecordPaths(changes.events);
      if (!changedPaths) return full;
      for (const path of changedPaths) paths.add(path);
      if (paths.size > 500) return full;
      invalidate ||= changes.events.length > 0;
      if (!changes.hasMore)
        return { paths, cursor: changes.cursor, invalidate };
      if (changes.cursor <= cursor) return full;
      cursor = changes.cursor;
    }
    return full;
  }

  private async reloadCache(
    paths?: Set<string>,
    signal = this.operationController.signal,
  ): Promise<{ scanned: number; changed: number; removed: number }> {
    const result = { scanned: 0, changed: 0, removed: 0 };
    if (paths?.size === 0) return result;
    const next = new Map<string, CachedMdbaseTask>();
    const writes = this.cache.trackWrites();
    try {
      let yieldAt = performance.now() + 8;
      let decodedCount = 0;
      const accept = async (records: ReadableMdbaseRecord[]) => {
        signal.throwIfAborted();
        result.scanned += records.length;
        for (const record of records) {
          if (++decodedCount % 128 === 0 && performance.now() >= yieldAt) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            signal.throwIfAborted();
            yieldAt = performance.now() + 8;
          }
          const decoded = this.readSummary(record);
          if (!decoded) continue;
          const cached = this.cache.get(decoded.task.id);
          next.set(
            decoded.task.id,
            cached &&
              cached.model === decoded.model &&
              sameConnectedTaskMetadata(cached.task, decoded.task)
              ? cached
              : decoded,
          );
        }
      };
      if (paths) {
        const batch = validResult(
          await this.connect.readMany([...paths], {
            types: [...this.taskProviders.keys()],
            includeBody: false,
            frontmatterMode: "effective",
            batchSize: 100,
            concurrency: 1,
            signal,
          }),
        );
        for (const error of batch.errors) validResult(error.failure);
        await accept(
          batch.results.flatMap((entry) =>
            entry.status === "found" ? [entry.record] : [],
          ),
        );
      } else if (
        validResult(
          await this.connect.supportsAuthorityFeature("query-metadata-v1", {
            signal,
          }),
        )
      ) {
        const fields = [
          ...new Set(
            [...this.taskProviders.values()].flatMap((model) =>
              model.summaryFields(),
            ),
          ),
        ];
        for await (const response of this.connect.queryPages(
          {
            timezone: runtimeTimezone(),
            types: [...this.taskProviders.keys()],
            output: "metadata",
            frontmatterMode: "effective",
            // Select only present literal keys. A list of key/value pairs
            // preserves absent versus null (important for legacy aliases),
            // and supports custom keys containing dots or CEL punctuation.
            select: [
              {
                name: "tasknotes_summary",
                expression: `${JSON.stringify(fields)}.filter(key, key in record).map(key, [key, record[key]])`,
              },
            ],
          },
          { pageSize: PAGE_SIZE, signal },
        )) {
          await accept(
            validResult(response).results.map((record) => {
              const values = record.values.tasknotes_summary;
              if (
                !Array.isArray(values) ||
                values.some(
                  (value) =>
                    !Array.isArray(value) ||
                    value.length !== 2 ||
                    typeof value[0] !== "string",
                )
              )
                throw new Error(
                  "The authority did not return the selected task summary fields.",
                );
              return {
                path: record.path,
                types: record.types,
                effectiveFrontmatter: Object.fromEntries(
                  values as [string, JsonObject[string]][],
                ),
              };
            }),
          );
        }
      } else {
        for await (const response of this.connect.queryPages(
          {
            timezone: runtimeTimezone(),
            types: [...this.taskProviders.keys()],
            includeBody: false,
            frontmatterMode: "effective",
          },
          { pageSize: PAGE_SIZE, signal },
        ))
          await accept(validResult(response).results);
      }
      signal.throwIfAborted();
      writes.stop();
      // Hints locate unloaded records; they must not resurrect identities that
      // an authoritative snapshot has removed or moved.
      for (const [id, hint] of this.viewTaskHints) {
        if (!paths || paths.has(hint.task.path)) this.viewTaskHints.delete(id);
      }
      // A query may be older than a write accepted while it was in flight. Do
      // not overwrite or resurrect locally changed paths with that snapshot.
      const previous = paths
        ? [...paths].flatMap((path) => {
            const value = this.cache.atPath(path);
            return value ? [value] : [];
          })
        : [...this.cache.values()];
      for (const { task } of previous) {
        if (!next.has(task.id) && !writes.paths.has(task.path)) {
          this.cache.delete(task.id);
          this.documents.delete(task.id);
          result.removed++;
        }
      }
      for (const [id, value] of next) {
        if (
          writes.paths.has(value.task.path) ||
          writes.paths.has(this.cache.get(id)?.task.path ?? "")
        )
          continue;
        if (this.cache.get(id) !== value || paths) result.changed++;
        // Metadata projections cannot detect body-only edits. A change event
        // or full rebuild invalidates any hydrated document for this path.
        this.documents.delete(id);
        this.cache.set(id, { ...value, revision: undefined });
      }
      return result;
    } finally {
      writes.stop();
    }
  }

  private async requireCurrent(
    id: string,
    fresh = false,
  ): Promise<CurrentTaskDocument> {
    if (!this.cache.has(id)) await this.ensureKnownTask(id);
    const cached = this.cache.get(id);
    if (!cached) throw new Error("Task not found.");
    // A desired-state no-op/retry must not mistake an old cached status for current authority state.
    if (fresh) return this.readCurrent(id, cached);
    const document = this.documents.get(id);
    if (
      document?.revision &&
      document.model === this.taskProviders.get(document.typeName)
    )
      return document as CurrentTaskDocument;
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
  ): Promise<CurrentTaskDocument> {
    const signal = this.operationController.signal;
    try {
      const result = validResult(
        await this.connect.read({ path: cached.task.path }, { signal }),
      );
      signal.throwIfAborted();
      if (this.cache.get(id) !== cached) {
        const current = this.documents.get(id);
        if (current?.revision) return current as CurrentTaskDocument;
        throw new Error(
          "The task changed while its document was loading. Try again.",
        );
      }
      const decoded = this.readRecord(result);
      if (!decoded) throw new Error("The task is no longer readable.");
      const current = {
        ...decoded,
        task:
          cached.model === decoded.model &&
          sameConnectedTaskMetadata(cached.task, decoded.task) &&
          cached.task.operationWarnings
            ? {
                ...decoded.task,
                operationWarnings: cached.task.operationWarnings,
              }
            : decoded.task,
        revision: result.revision,
      };
      if (decoded.task.id !== id) {
        this.cache.delete(id);
        this.documents.delete(id);
      }
      this.storeDocument(current);
      if (decoded.task.id !== id)
        throw new Error("The task identity changed. Refresh before editing.");
      return current;
    } catch (reason) {
      this.noteOperationFailure(reason);
      throw reason;
    }
  }

  private configureDescription(description: CollectionDescription): boolean {
    if (this.collectionId && description.collectionId !== this.collectionId)
      throw new Error("The connected mdbase collection changed unexpectedly.");
    // SDK cache hits share the same read-only object. Compare schema contents
    // only on a refetch: expiry can refetch without advancing schemaGeneration.
    if (this.description === description) return false;
    const nextSignature = JSON.stringify([
      description.displayName,
      description.types,
      description.contracts,
      description.configuration,
    ]);
    this.displayName = description.displayName;
    if (nextSignature === this.descriptionSignature) {
      this.description = description;
      return false;
    }
    const resolved = resolveTaskCollection(description);
    this.description = description;
    this.descriptionSignature = nextSignature;
    this.changeCursor = undefined;
    this.model = resolved.model;
    this.taskTypeName = resolved.typeName;
    this.taskProviders = new Map(
      resolved.providers.map((provider) => [provider.typeName, provider.model]),
    );
    return true;
  }

  private async persistUpdate(
    current: CurrentTaskDocument,
    next: Task,
  ): Promise<Task> {
    const operationInput = {
      path: current.task.path,
      patch: frontmatterPatch(current.task.frontmatter, next.frontmatter),
      body: next.body,
      ifRevision: current.revision,
    };
    try {
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

  private storeDocument(document: CachedTaskDocument): void {
    const { body, ...summary } = document.task;
    void body;
    const previous = this.cache.get(summary.id);
    const task =
      previous?.model === document.model &&
      sameConnectedTaskMetadata(previous.task, summary)
        ? previous.task
        : summary;
    this.cache.set(task.id, { ...document, task });
    this.documents.set(task.id, document);
  }

  private async hydrateTasks(
    tasks: TaskSummary[],
    signal: AbortSignal,
  ): Promise<Task[]> {
    const results = new Map<string, Task>();
    const pending: TaskSummary[] = [];
    for (const task of tasks) {
      const cached = this.documents.get(task.id);
      if (cached) results.set(task.id, cached.task);
      else pending.push(task);
    }
    const paths = pending.map((task) => task.path);
    const before = new Map(
      paths.map((path) => [path, this.cache.atPath(path)]),
    );
    const hydrated = validResult(
      await this.connect.readMany(paths, {
        types: [...this.taskProviders.keys()],
        includeBody: true,
        frontmatterMode: "effective",
        batchSize: 100,
        concurrency: 1,
        signal,
      }),
    );
    signal.throwIfAborted();
    // A successful envelope can contain failed batches. Never treat those as
    // missing records, or retain a partial hydration after an authority failure.
    for (const error of hydrated.errors) validResult(error.failure);
    for (const entry of hydrated.results) {
      if (entry.status !== "found") continue;
      const record = entry.record;
      const decoded = this.readRecord(record);
      if (!decoded) continue;
      if (this.cache.atPath(record.path) !== before.get(record.path)) {
        const current = this.documents.get(decoded.task.id);
        if (!current)
          throw new Error(
            "The task changed while its document was loading. Try again.",
          );
        results.set(current.task.id, current.task);
        continue;
      }
      // Install hydration's content/token together, never its discovery token.
      // This also reindexes externally changed metadata before any later edit.
      const previous = before.get(record.path);
      if (previous && previous.task.id !== decoded.task.id) {
        this.cache.delete(previous.task.id);
        this.documents.delete(previous.task.id);
      }
      this.storeDocument(decoded);
      results.set(decoded.task.id, decoded.task);
    }
    return tasks.flatMap((task) => {
      const value = results.get(task.id);
      return value ? [value] : [];
    });
  }

  private readSummary(record: ReadableMdbaseRecord): CachedMdbaseTask | null {
    const provider = this.providerForTypes(record.types ?? []);
    if (!provider) return null;
    try {
      return {
        task: provider.model.readSummary({
          path: record.path,
          frontmatter: mdbaseFrontmatter(record),
        }),
        ...provider,
      };
    } catch {
      return null;
    }
  }

  private storeResult(result: RecordDocument<JsonObject>): Task {
    const decoded = this.readRecord(result);
    if (!decoded) throw new Error("The saved task could not be read.");
    this.storeDocument({ ...decoded, revision: result.revision });
    this.setConnected();
    this.emit();
    return decoded.task;
  }

  private readRecord(record: ReadableMdbaseRecord): CachedTaskDocument | null {
    if (typeof record.body !== "string")
      throw new Error("The authority did not return the complete task body.");
    const provider = this.providerForTypes(record.types ?? []);
    if (!provider) return null;
    try {
      return {
        task: provider.model.read({
          path: record.path,
          frontmatter: mdbaseFrontmatter(record),
          body: record.body,
        }),
        revision: record.revision,
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
    await this.ensureTaskIndex();
    const parent = await this.requireCurrent(parentId);
    const occurrences = [...this.cache.values()]
      .map(({ task }) => task)
      .filter((task) => task.recurrenceParent && task.occurrenceDate);
    const resolved = findMaterializedOccurrenceTask(
      [...this.cache.values()].map(({ task }) => task),
      parent.task,
      occurrenceDate,
    );
    if (resolved)
      return {
        task: (await this.requireCurrent(resolved.id)).task,
        created: false,
        warnings: [],
      };
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
    if (!result.created)
      return {
        ...result,
        task: (await this.requireCurrent(result.task.id)).task,
      };
    const created = this.reserveAvailableTaskPath(result.task);
    const operationInput = {
      path: created.path,
      type: parent.typeName,
      frontmatter: asJson(created.frontmatter),
      body: created.body,
    };
    try {
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
      if (cached) this.storeDocument({ ...cached, task });
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
    completed?: boolean,
  ): Promise<Task> {
    const [occurrence, parent] = await Promise.all([
      this.requireCurrent(occurrenceId, completed !== undefined),
      this.requireCurrent(parentId, completed !== undefined),
    ]);
    if (occurrence.typeName !== parent.typeName)
      throw new Error(
        "A materialized occurrence and its parent must use the same TaskNotes implementation type.",
      );
    if (
      action === "toggle" &&
      completed !== undefined &&
      occurrence.task.completed === completed
    ) {
      this.emit();
      return occurrence.task;
    }
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
    if (cached) this.storeDocument({ ...cached, task });
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
    if (cached) this.storeDocument({ ...cached, task: retained });
    this.emit();
    return retained;
  }

  private async maintainRollingOccurrencesUnlocked(): Promise<void> {
    const parents = this.cache.rollingParents();
    for (const parent of parents) {
      const warnings = await this.materializeRollingWindow(parent);
      if (!warnings.length) continue;
      const cached = this.cache.get(parent.id);
      if (cached) {
        this.cache.set(parent.id, {
          ...cached,
          task: { ...cached.task, operationWarnings: warnings },
        });
        const document = this.documents.get(parent.id);
        if (document)
          this.documents.set(parent.id, {
            ...document,
            task: { ...document.task, operationWarnings: warnings },
          });
      }
    }
  }

  private async materializeRollingWindow(task: TaskSummary): Promise<string[]> {
    return materializeRollingWindow(task, (parentId, date) =>
      this.materializeOccurrenceUnlocked(parentId, date),
    );
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
      this.emit({ kind: "status" });
    }
  }

  private emit(change: RepositoryChange = { kind: "data" }): void {
    if (this.emitBatchDepth) {
      this.emitPending = true;
      return;
    }
    for (const listener of this.listeners) listener(change);
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
  const problem = connectProblemFromError(reason);
  if (problem) {
    if (
      problem.operation_outcome === "unknown" ||
      problem.recovery === "resolve_outcome"
    )
      return false;
    return problem.category === "availability";
  }
  return reason instanceof TypeError;
}

function connectionErrorMessage(reason: unknown): string {
  if (connectProblemFromError(reason)?.code === "connector_offline")
    return "The computer holding this collection is offline.";
  if (reason instanceof Error && reason.message) return reason.message;
  return "This collection is not reachable right now.";
}

import { projectShortcuts } from "../domain/project-shortcuts";
import { materializeDefaultViewOrder } from "../domain/view-document";
import { navigationTaskCounts } from "../domain/navigation-task-counts";
import type {
  CalendarTaskEdit,
  OccurrenceOverrides,
} from "../domain/calendar-edit";
import { Capacitor } from "@capacitor/core";
import {
  MdbaseError,
  isMdbaseError,
  toValue,
  resolveRecordLinks,
  type MdbaseClient,
  type MdbasePeopleClient,
  type ChangesWatch,
  type PlainValue,
  type BacklinksResult,
  type Receipt,
  type RecordView,
  type UpdateInput as NativeUpdateInput,
  type wire,
  describeHold,
  syncStatusText,
  type Hold,
  type SyncStatus,
  type WriteLedgerEntry,
} from "@mdbase-dev/sdk";
import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import {
  patchTaskNotesMdbaseTypeSettings,
  reconcileTaskNotesMdbaseTypeVocabulary,
  taskNotesVocabularyInUse,
} from "@tasknotes/model/mdbase";
import {
  TaskDeletionNotStartedError,
  TaskRevisionChangedError,
} from "../application/ports/task-repository";
import type {
  TaskRepository,
  TaskCreateIntent,
  RecordWriteRejection,
  RecordWriteTarget,
  RecordWriteStatus,
  RepositoryChange,
  RepositoryConnectionStatus,
  HeldEdit,
  HeldEditResolution,
  RefreshResult,
} from "../application/ports/task-repository";
import type {
  CreateTaskInput,
  UpdateTaskInput,
  Task,
  TaskSummary,
  TaskListQuery,
  TaskTimeEntry,
  MaterializeOccurrenceResult,
} from "../domain/task";
import { summarizeTask } from "../domain/task";
import { taskPathCandidates } from "../domain/task-path-policy";
import type { TaskNotesTaskModel } from "../domain/tasknotes-model";
import {
  splitTaskModelSettingsPatch,
  taskNotesSettingsChanges,
  type TaskModelSettingsPatch,
} from "../domain/task-configuration";
import type {
  FieldCompletionRequest,
  CollectionRecord,
} from "../domain/completion";
import type {
  TaskViewDocument,
  TaskView,
  TaskViewExecution,
  TaskViewSourceDocument,
  CreateTaskViewSourceInput,
  UpdateTaskViewSourceInput,
} from "../domain/view";
import { taskViewKey } from "../domain/view";
import type {
  AppBasesDescriptor,
  AppBasesWindow,
} from "@mdbase-dev/sdk/app-host";
import { runtimeTimezone } from "../domain/runtime-timezone";
import {
  iterateNativeDiscovery,
  nativeViewSelection,
} from "./next-bases-discovery";
import { readNativeRows } from "./next-bases-rows";
import { nativeCellValue } from "./next-bases-values";
import { nativeRowValues } from "./next-bases-row-values";
import { nativePresentation } from "./next-bases-presentation";
import { normalizeViewExecution } from "./views";
import {
  SCRATCHPAD_TYPE,
  scratchpadPage,
  type ScratchpadDocument,
  type ScratchpadPageRequest,
  type SaveScratchpadInput,
  type StartNewScratchpadInput,
  type ReactivateScratchpadInput,
  type ScratchpadReference,
  type ArchiveScratchpadInput,
} from "../domain/scratchpad";
import {
  SCRATCH_IMAGE_TYPE,
  type CreateScratchImageInput,
  type ScratchImage,
} from "../domain/scratch-image";
import {
  scratchImageFromRecord,
  scratchImageFrontmatter,
} from "./scratch-images";
import {
  scratchFeedPage,
  scratchpadFeedItem,
  type ScratchFeedPage,
  type ScratchFeedPageRequest,
} from "../domain/scratch-feed";
import {
  activeScratchpads,
  assertScratchpadRebase,
  assertScratchpadRevision,
  newScratchpadValues,
  scratchpadFromRecord,
  scratchpadFrontmatter,
} from "./scratchpads";
import { taskCompletion } from "../domain/task-completion";
import { runningTimers } from "../domain/running-timers";
import { taskSearchTokens } from "../domain/task-query";
import {
  findOccurrenceParent,
  occurrenceRecordId,
  rollingOccurrenceDates,
} from "../domain/task-occurrence";
import {
  newViewSourcePath,
  viewSourceFormat,
  viewSourceRecord,
} from "../domain/default-view-source";
import { normalizePresentationType } from "../domain/view-renderer";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";
import { NextMutations, RejectedNextMutation } from "./next-mutations";
import {
  nextTaskCatalog,
  nextTaskProviders,
  type NextTaskProvider,
} from "./next-task-catalog";
import {
  nativeTaskNotesSettingsStore,
  type TaskNotesSettingsStore,
} from "./next-app-settings";
import { appSettingsAccess, saveAppSettings } from "./task-app-settings";
import { nextTaskDocument, nextTaskSummary } from "./next-task-records";
import { peopleView } from "./mdbase-people";
import { ConnectedTaskIndex } from "./connected-task-index";
import { BoundedCache } from "./bounded-cache";
import { NextCollectionFileStore } from "./next-files";
import {
  CollectionChangeWindow,
  waitForChangeWindow,
} from "./collection-change-window";
import {
  connectedTaskRelationships,
  connectedTaskStats,
} from "./connected-task-cache";
import {
  completeTaskValues,
  completeRecords,
  completionLimit,
  usedValuesFirst,
} from "./completions";

/** A note's save input for its stored state. */
function stored(note: ScratchpadDocument): SaveScratchpadInput {
  return {
    id: note.id,
    path: note.path,
    revision: note.revision,
    baseBody: note.body,
    body: note.body,
  };
}

function createRecordOp(
  id: string,
  type: string,
  record: { path: string; frontmatter: Record<string, unknown>; body: string },
): wire.Op {
  return {
    kind: "create",
    id,
    type,
    path: record.path,
    frontmatter: new Map(
      Object.entries(record.frontmatter).map(([field, value]) => [
        field,
        toValue(value as PlainValue),
      ]),
    ),
    body: record.body,
  };
}

function taskChanges(
  record: RecordView,
  current: Task,
  next: Task,
): NativeUpdateInput {
  const patch: Record<string, PlainValue> = {};
  const unset: string[] = [];
  for (const field of new Set([
    ...Object.keys(current.frontmatter),
    ...Object.keys(next.frontmatter),
  ])) {
    if (
      JSON.stringify(current.frontmatter[field]) ===
      JSON.stringify(next.frontmatter[field])
    )
      continue;
    if (next.frontmatter[field] === undefined) unset.push(field);
    else patch[field] = next.frontmatter[field] as PlainValue;
  }
  return {
    patch,
    unset,
    ...(next.body !== current.body ? { body: next.body } : {}),
    ifRevision: record.revision,
  };
}

interface CachedTask {
  task: TaskSummary;
  recordId: string;
  model: TaskNotesTaskModel;
  typeName: string;
}

export function nativeUnsupported(message: string): MdbaseError {
  return new MdbaseError({
    code: "invalid_request",
    recovery: "fix_request",
    reason: "unsupported",
    message,
  });
}

/** Direct native SDK implementation of the application port.
 * Unsupported native metadata is explicit, never reconstructed in the app.
 */
export class NextTaskRepository implements TaskRepository {
  readonly files: NextCollectionFileStore;
  readonly defaultViewSourceCreation = "explicit-only" as const;
  private scope = new AbortController();
  private disposed = false;
  private providers: NextTaskProvider[] = [];
  private models = new Map<string, TaskNotesTaskModel>();
  private initialization: {
    pending: Promise<void>;
    signal: AbortSignal;
  } | null = null;
  private indexLoading: Promise<void> | null = null;
  private indexReady = false;
  private hasLoadedIndex = false;
  private readonly cache = new ConnectedTaskIndex<CachedTask>();
  private readonly mutations: NextMutations;
  private readonly readCurrentWrites: (
    ids: readonly string[],
    signal: AbortSignal,
  ) => Promise<void>;
  private readonly acceptedCreates = new WeakMap<TaskCreateIntent, Task>();
  private readonly listeners = new Set<(change?: RepositoryChange) => void>();
  private readonly stopLink: () => void;
  private status: RepositoryConnectionStatus = { state: "connecting" };
  /** The backend's sync position and protected edits, pushed by the client; merged into `connectionStatus()`. */
  private sync: RepositoryConnectionStatus["sync"];
  private heldEdits: HeldEdit[] = [];
  private readonly stopStatus: () => void;
  private readonly stopLedger: () => void;
  private readonly stopHolds: () => void;
  private viewCatalog: TaskViewDocument[] = [];
  private readonly viewExecutions = new BoundedCache<{
    signature: string;
    execution: TaskViewExecution | null;
  }>(
    16,
    8 * 1024 * 1024,
    (slot) =>
      2 *
      (slot.signature.length +
        (slot.execution ? JSON.stringify(slot.execution).length : 0)),
  );
  private nativeViews = new Map<string, AppBasesDescriptor>();
  /** The one native discovery pass in flight, shared by every caller. */
  private discovery: {
    pending: Promise<TaskViewDocument[]>;
    signal: AbortSignal;
  } | null = null;
  private readonly sourceRecords = new Map<string, string>();
  /** Records whose current read carries a hold or an unresolved conflict. */
  private readonly conflictedRecords = new Set<string>();
  private readonly knownTaskRecords = new Map<string, string>();
  private readonly scratchRecords = new Map<string, string>();

  private writeRecordId(target: RecordWriteTarget): string | undefined {
    return target.kind === "task"
      ? (this.cache.get(target.id)?.recordId ??
          this.knownTaskRecords.get(target.id))
      : target.kind === "source"
        ? this.sourceRecords.get(target.path)
        : this.scratchRecords.get(`${target.kind}:${target.id}`);
  }
  /** The SDK ledger's newest refused write to a record. */
  private refusedWrite(recordId: string) {
    let newest: WriteLedgerEntry | undefined;
    for (const entry of this.client.ledger.getSnapshot().rejected)
      if (
        entry.records.includes(recordId) &&
        (!newest || entry.createdAt >= newest.createdAt)
      )
        newest = entry;
    return newest;
  }
  writeRejection(target: RecordWriteTarget): RecordWriteRejection | undefined {
    const id = this.writeRecordId(target);
    const problem = id ? this.refusedWrite(id)?.problem : undefined;
    if (!problem || problem.code === "outcome_unknown") return undefined;
    return {
      changedElsewhere:
        problem.code === "conflict" && problem.reason === "revision",
      message: problem.message ?? "mdbase refused the change.",
    };
  }
  dismissWriteRejection(target: RecordWriteTarget): void {
    const id = this.writeRecordId(target);
    if (!id) return;
    const ledger = this.client.ledger;
    for (const entry of ledger.getSnapshot().rejected)
      if (entry.records.includes(id))
        void ledger.acknowledge(entry.mutationId).catch(() => {});
  }
  writeState(target: RecordWriteTarget): RecordWriteStatus | undefined {
    const id = this.writeRecordId(target);
    if (!id) return undefined;
    if (this.conflictedRecords.has(id)) return "conflicted";
    const refused = this.refusedWrite(id);
    if (refused)
      return refused.problem?.code === "outcome_unknown" ? "unknown" : "failed";
    return this.client.ledger.stateOf(id) === "saved" ? undefined : "pending";
  }
  /** The records an unconfirmed or refused write touches, once the SDK ledger
   * has restored the writes from before this session. */
  private async ledgerRecords(
    mutationId: string,
    signal: AbortSignal,
  ): Promise<readonly string[]> {
    const ledger = this.client.ledger;
    if (!ledger.getSnapshot().restored)
      await new Promise<void>((resolve) => {
        const done = () => {
          if (!ledger.getSnapshot().restored && !signal.aborted) return;
          stop();
          signal.removeEventListener("abort", done);
          resolve();
        };
        const stop = ledger.subscribe(done);
        signal.addEventListener("abort", done, { once: true });
        done();
      });
    signal.throwIfAborted();
    const { pending, rejected } = ledger.getSnapshot();
    return (
      [...pending, ...rejected].find((entry) => entry.mutationId === mutationId)
        ?.records ?? []
    );
  }
  private rememberWriteState(record: RecordView): void {
    if (record.state.hold || record.state.unresolved)
      this.conflictedRecords.add(record.id);
    else this.conflictedRecords.delete(record.id);
  }
  private scratchFeedSnapshot?: ScratchFeedPage;
  private dataRevision = 0;
  private readonly changeWindow = new CollectionChangeWindow(() => {
    if (!this.disposed && !this.scope.signal.aborted)
      this.listeners.forEach((listener) => listener({ kind: "data" }));
  });
  private changesWatch: ChangesWatch | null = null;
  /** The TaskNotes settings record (_settings/dev.tasknotes.md). */
  private readonly settings: TaskNotesSettingsStore;
  /** Whether the collection defines the tasknotes-settings type. */
  private settingsType = false;
  private readonly clientOwnership: "owned" | "borrowed";
  private readonly peopleClient?: Pick<MdbasePeopleClient, "directory">;

  constructor(
    private readonly client: MdbaseClient,
    private readonly displayName: string,
    private readonly accountId: string,
    options: {
      /** Host-owned clients survive this adapter's disposal; default remains owned. */
      clientOwnership?: "owned" | "borrowed";
      peopleClient?: Pick<MdbasePeopleClient, "directory">;
    } = {},
  ) {
    this.clientOwnership = options.clientOwnership ?? "owned";
    this.peopleClient = options.peopleClient;
    this.files = new NextCollectionFileStore(
      client.files,
      () => this.scope.signal,
    );
    this.readCurrentWrites = async (
      ids: readonly string[],
      signal: AbortSignal,
    ) => {
      for (const id of ids) {
        const record = await client.find(id, {
          include: { body: true, document: true, effective: true },
          signal,
        });
        signal.throwIfAborted();
        if (!record) {
          this.conflictedRecords.delete(id);
          continue;
        }
        if (record.id !== id)
          throw new Error("The restored native record changed identity.");
        this.rememberWriteState(record);
        if (record.types.some((type) => this.models.has(type))) {
          const expected = [...this.knownTaskRecords].find(
            ([, nativeId]) => nativeId === id,
          )?.[0];
          const task = nextTaskDocument(record, this.models);
          if (expected && task?.id !== expected)
            throw new Error(
              "The original task changed portable identity during current-layer READ.",
            );
          this.remember(record);
        } else if (record.types.includes(SCRATCHPAD_TYPE))
          this.scratchpad(record);
        else if (record.types.includes(SCRATCH_IMAGE_TYPE))
          this.scratchImage(record);
        else if (viewSourceFormat(record.path) === "obsidian.base") {
          const expected = [...this.sourceRecords].find(
            ([, nativeId]) => nativeId === id,
          )?.[0];
          if (expected && record.path !== expected)
            throw new Error(
              "The original view source changed path during current-layer READ.",
            );
          this.sourceDocument(record, record.path);
        }
      }
      this.emit("data");
    };
    this.mutations = new NextMutations(client, this.readCurrentWrites);
    this.settings = nativeTaskNotesSettingsStore(
      client,
      this.mutations,
      () => this.scope.signal,
    );
    this.stopLedger = client.ledger.subscribe(() => {
      if (!this.disposed && !this.scope.signal.aborted) this.emit("status");
    });
    let syncConnection = client.status?.connection;
    this.stopStatus = client.onStatus((status: SyncStatus) => {
      if (this.disposed) return;
      const restored =
        syncConnection !== undefined &&
        syncConnection !== "online" &&
        status.connection === "online";
      syncConnection = status.connection;
      this.sync = {
        text: syncStatusText(status),
        pending: status.pending,
        held: status.holds,
      };
      // A local replica's change watch stays active while its upstream is
      // offline. Native sync recovery must reopen failed READ models too.
      if (
        restored &&
        !this.scope.signal.aborted &&
        this.changesWatch?.state === "active"
      )
        this.invalidateRemoteData();
      this.emit("status");
    });
    this.stopHolds = client.onHolds((holds: Hold[]) => {
      if (this.disposed) return;
      this.heldEdits = holds.map((hold) => heldEditFromHold(hold));
      this.emit("status");
    });
    this.stopLink = client.onLink((state, reason) => {
      if (this.disposed || this.scope.signal.aborted) return;
      if (
        state === "open" &&
        this.changesWatch &&
        this.changesWatch.state !== "active"
      )
        return;
      this.status =
        state === "open"
          ? { state: "connected", lastReachedAt: new Date().toISOString() }
          : {
              state: "unavailable",
              message: reason?.message ?? "Mdbase is not reachable.",
            };
      this.emit("status");
    });
  }

  private signal(extra?: AbortSignal): AbortSignal {
    if (this.disposed)
      throw new Error("The native collection instance has been disposed.");
    return AbortSignal.any([
      this.scope.signal,
      ...(extra ? [extra] : []),
      AbortSignal.timeout(TASKNOTES_REQUEST_BUDGETS.foregroundMs),
    ]);
  }

  private assertCurrentData(revision: number) {
    if (revision !== this.dataRevision) throw collectionChanged();
  }

  private invalidateRemoteData(coalesce = false) {
    this.initialization = null;
    this.indexReady = false;
    this.viewCatalog = [];
    this.nativeViews.clear();
    if (coalesce) {
      // Retire the cut immediately; only UI reload notifications are delayed.
      this.invalidateDataGeneration();
      this.changeWindow.changed();
    } else this.emit("data");
  }

  private async observeChanges(signal: AbortSignal): Promise<void> {
    if (!this.changesWatch) {
      const scope = this.scope;
      const current = () =>
        !this.disposed &&
        !scope.signal.aborted &&
        scope === this.scope &&
        this.changesWatch === watch;
      const watch = this.client.watchChanges(() => {
        if (current()) this.invalidateRemoteData(true);
      });
      this.changesWatch = watch;
      watch.subscribe((state, error) => {
        if (!current()) return;
        if (state === "active") {
          this.status = {
            state: "connected",
            lastReachedAt: new Date().toISOString(),
          };
          // An authenticated watch becoming active establishes a new READ cut,
          // even if upstream restoration arrived before watch activation.
          this.invalidateRemoteData();
          this.emit("status");
        }
        if (state === "stale" || state === "failed") {
          this.status = {
            state: "unavailable",
            message: error?.message ?? "Mdbase is not reachable.",
          };
          this.invalidateRemoteData();
          this.emit("status");
        }
      });
    }
    const watch = this.changesWatch;
    signal.throwIfAborted();
    let aborted!: () => void;
    const cancellation = new Promise<never>((_, reject) => {
      aborted = () => reject(signal.reason);
      signal.addEventListener("abort", aborted, { once: true });
    });
    try {
      await Promise.race([watch.ready, cancellation]);
      signal.throwIfAborted();
      if (watch.state !== "active")
        throw (
          watch.error ??
          new MdbaseError({
            code: "unavailable",
            recovery: "retry",
            message: "The collection change subscription is not active.",
          })
        );
    } finally {
      signal.removeEventListener("abort", aborted);
    }
  }

  async initialize(options: { deferTaskIndex?: boolean } = {}): Promise<void> {
    const signal = this.signal();
    await this.readCurrentGeneration(signal, async () => {
      await this.initializeModel(signal);
      if (!options.deferTaskIndex) await this.loadIndex(signal);
    });
  }

  /** Catch-up may retire several READ cuts. Wait for quiet and reread using
   * the original owner/deadline, not an arbitrary one-retry limit. Every cut
   * must still pass its generation/native fences; mutations are never retried. */
  private async readCurrentGeneration<Result>(
    signal: AbortSignal,
    read: () => Promise<Result>,
  ): Promise<Result> {
    for (;;) {
      signal.throwIfAborted();
      if (this.changeWindow.unsettled) await this.changeWindow.quiet(signal);
      const generation = this.dataRevision;
      try {
        const result = await read();
        signal.throwIfAborted();
        return result;
      } catch (reason) {
        signal.throwIfAborted();
        if (
          !(reason instanceof MdbaseError) ||
          reason.code !== "conflict" ||
          // The replica also retires a discovery cursor when the collection
          // moves under it. Connected computers throw this; the local runtime
          // returns it as a refusal, and both arrive here as an MdbaseError.
          (reason.reason !== "collection_changed" &&
            reason.reason !== "view_discovery_stale")
        )
          throw reason;
        // A currentness refusal is a retired READ, not a failed collection.
        // When a local change event retired it, the new generation already
        // exists: reread at once (a coalesced native change still waits for
        // its quiet window above). Pace only a refusal no local event explains.
        if (this.dataRevision === generation)
          await waitForChangeWindow(250, signal);
      }
    }
  }

  private async initializeModel(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await this.observeChanges(signal);
    for (;;) {
      signal.throwIfAborted();
      if (!this.initialization) {
        const revision = this.dataRevision;
        const loading = (async () => {
          // The record is read first: its fields win over the type binding's.
          const settings = await this.settings.reload(signal);
          signal.throwIfAborted();
          const { providers, settingsType } = await nextTaskCatalog(
            this.client,
            signal,
            { settings: settings.frontmatter },
          );
          signal.throwIfAborted();
          this.assertCurrentData(revision);
          this.settingsType = settingsType;
          this.providers = providers;
          this.models = new Map(providers.map((p) => [p.typeName, p.model]));
          this.reached(false);
        })().catch((reason) => {
          if (this.initialization?.pending === loading)
            this.initialization = null;
          this.noteOperationFailure(reason, signal);
          throw reason;
        });
        this.initialization = { pending: loading, signal };
      }
      const read = this.initialization;
      try {
        await read.pending;
        signal.throwIfAborted();
        return;
      } catch (reason) {
        signal.throwIfAborted();
        // A shared model READ belongs to its initiating caller. Retiring that
        // caller must not transfer its RPC cancellation to other current reads.
        // Only an actually aborted foreign owner permits another READ, under
        // this caller's original lifecycle/deadline. Native refusals, channel
        // loss and mutations are not retried or hidden here.
        if (
          !read.signal.aborted ||
          (reason !== read.signal.reason &&
            (!(reason instanceof MdbaseError) || reason.code !== "cancelled"))
        )
          throw reason;
        if (this.initialization === read) this.initialization = null;
      }
    }
  }

  private async ensureIndex(): Promise<void> {
    const signal = this.signal();
    await this.readCurrentGeneration(signal, () => this.loadIndex(signal));
  }

  private async loadIndex(signal: AbortSignal): Promise<void> {
    await this.initializeModel(signal);
    signal.throwIfAborted();
    if (this.indexReady) return;
    if (this.indexLoading) return this.indexLoading;
    const writes = this.cache.trackWrites();
    const revision = this.dataRevision;
    const loading = (async () => {
      const snapshot = new Map<string, CachedTask>();
      const records = new Map<string, RecordView>();
      for await (const page of this.client.pages(
        { types: [...this.models.keys()], limit: 1000 },
        { include: { effective: true }, signal },
      )) {
        signal.throwIfAborted();
        if (!page.complete)
          throw nativeUnsupported(
            "The replica has not supplied a complete task index.",
          );
        for (const record of page.records) {
          const decoded = this.decodeSummary(record, false);
          if (decoded) {
            const previous = snapshot.get(decoded.task.id);
            if (previous && previous.recordId !== decoded.recordId)
              throw new Error(
                "Two native records have the same portable TaskNotes identity. Resolve the duplicate before opening this collection.",
              );
            snapshot.set(decoded.task.id, decoded);
            records.set(decoded.task.id, record);
          }
        }
      }
      signal.throwIfAborted();
      this.assertCurrentData(revision);
      for (const [id, existing] of this.cache) {
        if (!writes.paths.has(existing.task.path) && !snapshot.has(id))
          this.cache.delete(id);
      }
      for (const [id, value] of snapshot)
        if (!writes.paths.has(value.task.path)) {
          this.rememberWriteState(records.get(id)!);
          this.knownTaskRecords.set(id, value.recordId);
          this.cache.set(id, value);
        }
      this.indexReady = true;
      if (!this.hasLoadedIndex) this.emit("status");
      this.hasLoadedIndex = true;
      this.reached();
    })().finally(() => {
      writes.stop();
      if (this.indexLoading === loading) this.indexLoading = null;
    });
    this.indexLoading = loading;
    return loading;
  }

  private decodeSummary(
    record: RecordView,
    remember = true,
  ): CachedTask | null {
    const task = nextTaskSummary(record, this.models);
    if (!task) return null;
    if (remember) {
      this.rememberWriteState(record);
      this.knownTaskRecords.set(task.id, record.id);
    }
    const typeName = record.types.find((name) => this.models.has(name))!;
    return {
      task,
      recordId: record.id,
      typeName,
      model: this.models.get(typeName)!,
    };
  }

  private remember(record: RecordView): Task {
    this.rememberWriteState(record);
    const task = nextTaskDocument(record, this.models);
    if (!task)
      throw new Error(
        "The saved record no longer provides the TaskNotes task contract.",
      );
    const typeName = record.types.find((name) => this.models.has(name))!;
    const identity = this.cache.get(task.id);
    if (identity && identity.recordId !== record.id)
      throw new Error(
        "The portable task identity now belongs to a different native record. Refresh before continuing.",
      );
    const previous = this.cache.atPath(task.path);
    if (previous && previous.task.id !== task.id)
      this.cache.delete(previous.task.id);
    this.knownTaskRecords.set(task.id, record.id);
    this.cache.set(task.id, {
      task: summarizeTask(task),
      recordId: record.id,
      model: this.models.get(typeName)!,
      typeName,
    });
    this.reached();
    return task;
  }

  private async current(id: string, signal: AbortSignal) {
    await this.ensureIndex();
    signal.throwIfAborted();
    const entry = this.cache.get(id);
    if (!entry) throw new Error("The task is no longer available.");
    const record = await this.client.get(entry.recordId, {
      include: { body: true, effective: true },
      signal,
    });
    signal.throwIfAborted();
    if (record.id !== entry.recordId)
      throw new Error(
        "The native task READ changed its original record identity.",
      );
    this.rememberWriteState(record);
    if (record.state.hold || record.state.unresolved)
      throw new Error(
        "Resolve this task’s conflicting changes before editing it.",
      );
    const task = this.remember(record);
    if (task.id !== id)
      throw new Error(
        "The portable task identity changed. Refresh before editing.",
      );
    return { record, task, model: entry.model };
  }

  async refresh(): Promise<RefreshResult> {
    const signal = this.signal();
    try {
      const start = performance.now();
      const before = new Map(
        [...this.cache].map(([id, value]) => [id, JSON.stringify(value.task)]),
      );
      await this.indexLoading;
      signal.throwIfAborted();
      if (
        this.changesWatch &&
        ["failed", "closed"].includes(this.changesWatch.state)
      ) {
        this.changesWatch();
        this.changesWatch = null;
      }
      this.initialization = null;
      this.indexReady = false;
      await this.initialize();
      signal.throwIfAborted();
      const changed = [...this.cache].filter(
        ([id, value]) => before.get(id) !== JSON.stringify(value.task),
      ).length;
      const removed = [...before.keys()].filter(
        (id) => !this.cache.has(id),
      ).length;
      this.emit("data");
      return {
        scanned: this.cache.size,
        changed,
        removed,
        elapsedMs: Math.round(performance.now() - start),
      };
    } catch (reason) {
      this.noteOperationFailure(reason, signal);
      throw reason;
    }
  }

  async listSummaries(
    query: Omit<TaskListQuery, "search"> = {},
  ): Promise<TaskSummary[]> {
    if (query.limit === 0) return [];
    const signal = this.signal();
    await this.ensureIndex();
    signal.throwIfAborted();
    const paths = await this.assignedPaths(query.assignedTo, signal);
    signal.throwIfAborted();
    return this.cache.list(query, undefined, paths);
  }

  private scratchpad(record: RecordView, remember = true): ScratchpadDocument {
    if (record.body === undefined)
      throw new Error("Mdbase did not return the complete scratchpad body.");
    const note = scratchpadFromRecord({
      path: record.path,
      revision: record.revision,
      types: record.types,
      frontmatter: record.frontmatter,
      body: record.body,
    });
    if (remember) {
      this.rememberWriteState(record);
      this.scratchRecords.set(`scratchpad:${note.id}`, record.id);
    }
    return note;
  }

  private requireUnprotectedRecord(record: RecordView): void {
    if (
      !Number.isSafeInteger(record.state.confirmedSeq) ||
      (record.state.state !== "pending" &&
        record.state.state !== "confirmed") ||
      record.state.hold ||
      record.state.unresolved
    )
      throw new Error(
        "Resolve this record’s conflicting changes before editing it.",
      );
  }

  private async readScratchWriteRecords(
    witnesses: ReadonlyMap<string, string>,
    kind: "scratchpad" | "image",
    signal: AbortSignal,
  ): Promise<void> {
    for (const [nativeId, portableId] of witnesses) {
      const record = await this.client.find(nativeId, {
        include: { body: true },
        signal,
      });
      signal.throwIfAborted();
      if (!record) {
        // An admitted older change can now be absent after a newer deletion.
        this.conflictedRecords.delete(nativeId);
        continue;
      }
      if (record.id !== nativeId)
        throw new Error(
          "The original Scratchpad record changed native identity.",
        );
      this.requireUnprotectedRecord(record);
      const value =
        kind === "scratchpad"
          ? this.scratchpad(record, false)
          : this.scratchImage(record, false);
      if (value.id !== portableId)
        throw new Error(
          "The original Scratchpad record changed portable identity.",
        );
      if (kind === "scratchpad") this.scratchpad(record);
      else this.scratchImage(record);
    }
    signal.throwIfAborted();
    this.emit("data");
  }

  private async scratchpadRecords(signal: AbortSignal): Promise<RecordView[]> {
    const records: RecordView[] = [];
    const identities = new Set<string>();
    // Query every note: an incomplete narrowed answer must never create a note.
    for await (const page of this.client.pages(
      { types: [SCRATCHPAD_TYPE], limit: 1000 },
      { include: { body: true }, signal },
    )) {
      signal.throwIfAborted();
      if (!page.complete)
        throw nativeUnsupported(
          "The replica has not supplied a complete scratchpad stream.",
        );
      for (const record of page.records) {
        const note = this.scratchpad(record, false);
        if (identities.has(note.id))
          throw new Error(
            "Two native notes have the same portable Scratchpad identity. Resolve the duplicate before opening this stream.",
          );
        identities.add(note.id);
        records.push(record);
      }
    }
    signal.throwIfAborted();
    for (const record of records) this.scratchpad(record);
    return records;
  }

  private findScratchpad(
    records: RecordView[],
    reference: { id: string; path?: string },
  ): RecordView {
    const record = records.find(
      (record) => this.scratchpad(record).id === reference.id,
    );
    if (!record) throw new Error("The scratchpad is no longer available.");
    const note = this.scratchpad(record);
    if (reference.path && note.path !== reference.path)
      throw new Error("This scratchpad changed. Reload it before saving.");
    return record;
  }

  private currentScratchpad(records: RecordView[]): RecordView {
    const notes = records.map((record) => ({
      path: record.path,
      revision: record.revision,
      types: record.types,
      frontmatter: record.frontmatter,
      body: record.body,
    }));
    const current = activeScratchpads(notes)[0];
    if (!current)
      throw new Error(
        "The current note is no longer available. Reload before continuing.",
      );
    return this.findScratchpad(records, current);
  }

  private async savedScratchpad(
    nativeId: string,
    portableId: string,
    signal: AbortSignal,
  ): Promise<ScratchpadDocument> {
    const record = await this.client.get(nativeId, {
      include: { body: true },
      signal,
    });
    signal.throwIfAborted();
    if (record.id !== nativeId)
      throw new Error("The saved scratchpad's native identity changed.");
    this.requireUnprotectedRecord(record);
    const note = this.scratchpad(record, false);
    if (note.id !== portableId)
      throw new Error(
        "The saved scratchpad's portable identity changed. Reload before continuing.",
      );
    return this.scratchpad(record);
  }

  private async createdScratchpad(
    nativeId: string,
    receipt: Receipt,
    signal: AbortSignal,
    allowPending = false,
    body = "",
  ): Promise<ScratchpadDocument> {
    const record = await this.client.get(nativeId, {
      include: { body: true },
      signal,
    });
    signal.throwIfAborted();
    const admitted = receipt.records?.find((item) => item.id === nativeId);
    if (
      record.id !== nativeId ||
      !Number.isSafeInteger(record.state.confirmedSeq) ||
      (record.state.state !== "confirmed" &&
        !(allowPending && record.state.state === "pending")) ||
      record.state.hold ||
      record.state.unresolved ||
      (receipt.records !== undefined &&
        (!admitted ||
          admitted.path !== record.path ||
          admitted.revision !== record.revision))
    )
      throw new Error(
        "The original created scratchpad could not be confirmed by its native identity and revision.",
      );
    // Native on_create may assign the portable ID. Decode its actual result
    // only for this original creation; existing-note witnesses stay exact.
    const note = this.scratchpad(record, false);
    if (note.state !== "active" || note.body !== body)
      throw new Error("The created scratchpad changed before its result READ.");
    return this.scratchpad(record);
  }

  /** The current note before anything is written in it (revision ""). A
   * collection without an active note gets this instead of a stored empty one,
   * so opening the Scratchpad writes nothing: on a fresh browser an empty note
   * would be work before connecting. Its first change creates the record. */
  private unsavedScratchpad: ScratchpadDocument | null = null;

  private unsaved(): ScratchpadDocument {
    if (!this.unsavedScratchpad) {
      const values = newScratchpadValues();
      this.unsavedScratchpad = scratchpadFromRecord({
        path: values.path,
        revision: "",
        types: [SCRATCHPAD_TYPE],
        frontmatter: values.frontmatter as Record<string, PlainValue>,
        body: values.body,
      });
    }
    return this.unsavedScratchpad;
  }

  private isUnsaved(note: { id: string; revision: string }): boolean {
    return note.revision === "" && note.id === this.unsavedScratchpad?.id;
  }

  getActiveScratchpad(): Promise<ScratchpadDocument> {
    const signal = this.signal();
    let target: { nativeId: string; portableId: string };
    let recordIds: string[] = [];
    const witnesses = new Map<string, string>();
    const read = async (_: Receipt, requestSignal: AbortSignal) => {
      const current = await this.savedScratchpad(
        target.nativeId,
        target.portableId,
        requestSignal,
      );
      this.reached();
      this.emit("data");
      return current;
    };
    return this.mutations.run(
      {
        key: JSON.stringify(["scratchpad:active"]),
        recordIds: () => recordIds,
        ack: (_, signal) =>
          this.readScratchWriteRecords(witnesses, "scratchpad", signal),
        prepare: async (mutationId, requestSignal) => {
          const records = await this.scratchpadRecords(requestSignal);
          if (
            !records.some(
              (record) => this.scratchpad(record).state === "active",
            )
          )
            return { value: this.unsaved() };
          const current = this.currentScratchpad(records);
          const duplicates = records.filter(
            (record) =>
              record.id !== current.id &&
              this.scratchpad(record).state === "active",
          );
          if (!duplicates.length) return { value: this.scratchpad(current) };
          for (const record of [current, ...duplicates])
            this.requireUnprotectedRecord(record);
          recordIds = [current, ...duplicates].map((record) => record.id);
          for (const record of [current, ...duplicates])
            witnesses.set(record.id, this.scratchpad(record).id);
          target = {
            nativeId: current.id,
            portableId: this.scratchpad(current).id,
          };
          const now = new Date().toISOString();
          // CAS the selected winner as well as every duplicate, so a concurrent
          // edit cannot silently change the basis of the repair.
          const ops = [
            this.client.updateOp(current, { ifRevision: current.revision }),
            ...duplicates.map((record) =>
              this.client.updateOp(record, {
                patch: { state: "converted", dateConverted: now },
                ifRevision: record.revision,
              }),
            ),
          ];
          return async () =>
            this.client.submit(ops, {
              mutationId,
              signal: requestSignal,
            });
        },
        local: read,
        confirmed: read,
      },
      signal,
    );
  }

  /** Store the unsaved current note with its first content. */
  private createScratchpad(
    input: SaveScratchpadInput,
  ): Promise<ScratchpadDocument> {
    const signal = this.signal();
    const captured = structuredClone(input);
    const unsaved = this.unsaved();
    assertScratchpadRebase(unsaved, captured);
    const nativeId = crypto.randomUUID();
    let portableId: string | undefined;
    const witnesses = new Map<string, string>();
    const read = async (
      receipt: Receipt,
      requestSignal: AbortSignal,
      local = false,
    ) => {
      const current = portableId
        ? await this.savedScratchpad(nativeId, portableId, requestSignal)
        : await this.createdScratchpad(
            nativeId,
            receipt,
            requestSignal,
            local,
            captured.body,
          );
      // Only the first original creation READ may accept a native-assigned ID.
      // Later ACKs read current bytes under that exact established witness.
      portableId = current.id;
      witnesses.set(nativeId, current.id);
      if (this.unsavedScratchpad === unsaved) this.unsavedScratchpad = null;
      this.reached();
      this.emit("data");
      return current;
    };
    return this.mutations.run(
      {
        key: JSON.stringify(["scratchpad:create", captured]),
        recordIds: () => [nativeId],
        ack: (_, signal) =>
          this.readScratchWriteRecords(witnesses, "scratchpad", signal),
        prepare: async (mutationId, requestSignal) => {
          const now = new Date().toISOString();
          return () =>
            this.client.create(
              {
                id: nativeId,
                type: SCRATCHPAD_TYPE,
                path: unsaved.path,
                frontmatter: scratchpadFrontmatter(unsaved, {
                  ...(captured.title !== undefined
                    ? { title: captured.title }
                    : {}),
                  dateModified: now,
                }) as Record<string, PlainValue>,
                body: captured.body,
              },
              { mutationId, signal: requestSignal },
            );
        },
        local: (receipt, requestSignal) => read(receipt, requestSignal, true),
        confirmed: read,
      },
      signal,
    );
  }

  async getScratchpad(id: string): Promise<ScratchpadDocument | null> {
    const records = await this.scratchpadRecords(this.signal());
    const record = records.find((record) => this.scratchpad(record).id === id);
    return record ? this.scratchpad(record) : null;
  }

  async listScratchpads(request: ScratchpadPageRequest = {}) {
    await this.getActiveScratchpad();
    const records = await this.scratchpadRecords(this.signal());
    return scratchpadPage(
      records.map((record) => this.scratchpad(record)),
      request,
    );
  }

  saveScratchpad(input: SaveScratchpadInput): Promise<ScratchpadDocument> {
    if (this.isUnsaved(input)) return this.createScratchpad(input);
    const signal = this.signal();
    const captured = structuredClone(input);
    let nativeId: string;
    return this.mutations.runRecord(
      {
        key: JSON.stringify(["scratchpad:save", captured]),
        recordIds: () => [nativeId],
        ack: (_, signal) =>
          this.readScratchWriteRecords(
            new Map([[nativeId, captured.id]]),
            "scratchpad",
            signal,
          ),
        prepare: async (mutationId, requestSignal) => {
          const record = this.findScratchpad(
            await this.scratchpadRecords(requestSignal),
            captured,
          );
          this.requireUnprotectedRecord(record);
          const current = this.scratchpad(record);
          assertScratchpadRebase(current, captured);
          nativeId = record.id;
          const op = this.client.updateOp(record, {
            patch: scratchpadFrontmatter(current, {
              title: captured.title,
              dateModified: new Date().toISOString(),
            }) as Record<string, PlainValue>,
            body: captured.body,
            ifRevision: record.revision,
          });
          return async () =>
            this.client.submit([op], {
              mutationId,
              signal: requestSignal,
            });
        },
        confirmed: async (_, requestSignal) => {
          const note = await this.savedScratchpad(
            nativeId,
            captured.id,
            requestSignal,
          );
          this.reached();
          this.emit("data");
          return note;
        },
      },
      signal,
    );
  }

  async startNewScratchpad(input: StartNewScratchpadInput) {
    return this.startNew(
      this.isUnsaved(input)
        ? stored(await this.createScratchpad(input))
        : input,
    );
  }

  private startNew(input: StartNewScratchpadInput) {
    const signal = this.signal();
    const captured = structuredClone(input);
    let previousId: string;
    let next: { nativeId: string; portableId?: string };
    const read = async (
      receipt: Receipt,
      requestSignal: AbortSignal,
      local = false,
    ) => {
      const previous = await this.savedScratchpad(
        previousId,
        captured.id,
        requestSignal,
      );
      const current = next.portableId
        ? await this.savedScratchpad(
            next.nativeId,
            next.portableId,
            requestSignal,
          )
        : await this.createdScratchpad(
            next.nativeId,
            receipt,
            requestSignal,
            local,
          );
      next.portableId = current.id;
      this.reached();
      this.emit("data");
      return { previous, current };
    };
    return this.mutations.run(
      {
        key: JSON.stringify(["scratchpad:new", captured]),
        recordIds: () => [previousId, next.nativeId],
        ack: (_, signal) =>
          this.readScratchWriteRecords(
            new Map([
              [previousId, captured.id],
              [next.nativeId, next.portableId!],
            ]),
            "scratchpad",
            signal,
          ),
        prepare: async (mutationId, requestSignal) => {
          const records = await this.scratchpadRecords(requestSignal);
          const record = this.currentScratchpad(records);
          this.requireUnprotectedRecord(record);
          const current = this.scratchpad(record);
          assertScratchpadRevision(current, captured);
          const now = new Date().toISOString();
          const values = newScratchpadValues(now);
          previousId = record.id;
          next = { nativeId: crypto.randomUUID() };
          const ops: wire.Op[] = [
            this.client.updateOp(record, {
              patch: scratchpadFrontmatter(current, {
                state: "converted",
                title: captured.title,
                dateModified: now,
                dateConverted: now,
              }) as Record<string, PlainValue>,
              body: captured.body,
              ifRevision: record.revision,
            }),
            createRecordOp(next.nativeId, SCRATCHPAD_TYPE, values),
          ];
          return async () =>
            this.client.submit(ops, {
              mutationId,
              signal: requestSignal,
            });
        },
        local: (receipt, requestSignal) => read(receipt, requestSignal, true),
        confirmed: read,
      },
      signal,
    );
  }

  async reactivateScratchpad(input: ReactivateScratchpadInput) {
    return this.reactivate(
      this.isUnsaved(input.current)
        ? {
            ...input,
            current: stored(
              await this.createScratchpad({
                ...input.current,
                baseBody: "",
                body: "",
              }),
            ),
          }
        : input,
    );
  }

  private reactivate(input: ReactivateScratchpadInput) {
    const signal = this.signal();
    const captured = structuredClone(input);
    let previousId: string;
    let currentId: string;
    return this.mutations.runRecord(
      {
        key: JSON.stringify(["scratchpad:reactivate", captured]),
        recordIds: () => [previousId, currentId],
        ack: (_, signal) =>
          this.readScratchWriteRecords(
            new Map([
              [previousId, captured.current.id],
              [currentId, captured.target.id],
            ]),
            "scratchpad",
            signal,
          ),
        prepare: async (mutationId, requestSignal) => {
          if (captured.current.id === captured.target.id)
            throw new Error("The current scratchpad cannot resume itself.");
          const records = await this.scratchpadRecords(requestSignal);
          const previous = this.currentScratchpad(records);
          const current = this.findScratchpad(records, captured.target);
          for (const record of [previous, current])
            this.requireUnprotectedRecord(record);
          assertScratchpadRevision(this.scratchpad(previous), captured.current);
          assertScratchpadRevision(this.scratchpad(current), captured.target);
          if (this.scratchpad(current).state !== "converted")
            throw new Error("Only a previous scratchpad can be resumed.");
          previousId = previous.id;
          currentId = current.id;
          const now = new Date().toISOString();
          const ops = [
            this.client.updateOp(previous, {
              patch: {
                state: "converted",
                dateModified: now,
                dateConverted: now,
              },
              ifRevision: previous.revision,
            }),
            this.client.updateOp(current, {
              patch: { state: "active", dateModified: now },
              ifRevision: current.revision,
            }),
          ];
          return async () =>
            this.client.submit(ops, {
              mutationId,
              signal: requestSignal,
            });
        },
        confirmed: async (_, requestSignal) => {
          const previous = await this.savedScratchpad(
            previousId,
            captured.current.id,
            requestSignal,
          );
          const current = await this.savedScratchpad(
            currentId,
            captured.target.id,
            requestSignal,
          );
          this.reached();
          this.emit("data");
          return { previous, current };
        },
      },
      signal,
    );
  }

  deleteScratchpad(input: ScratchpadReference): Promise<void> {
    const signal = this.signal();
    const captured = structuredClone(input);
    let nativeId: string;
    return this.mutations.runRecord(
      {
        key: JSON.stringify(["scratchpad:delete", captured]),
        recordIds: () => [nativeId],
        ack: (_, signal) =>
          this.readScratchWriteRecords(
            new Map([[nativeId, captured.id]]),
            "scratchpad",
            signal,
          ),
        prepare: async (mutationId, requestSignal) => {
          const record = this.findScratchpad(
            await this.scratchpadRecords(requestSignal),
            captured,
          );
          this.requireUnprotectedRecord(record);
          const note = this.scratchpad(record);
          assertScratchpadRevision(note, captured);
          if (note.state !== "converted")
            throw new Error("Only a previous note can be deleted.");
          nativeId = record.id;
          const op: wire.Op = {
            kind: "delete",
            id: record.id,
            ifRevision: record.revision,
          };
          return async () =>
            this.client.submit([op], {
              mutationId,
              signal: requestSignal,
            });
        },
        confirmed: async (_, requestSignal) => {
          if (await this.client.find(nativeId, { signal: requestSignal }))
            throw new Error(
              "The original scratchpad deletion is not visible in the native layer.",
            );
          requestSignal.throwIfAborted();
          this.conflictedRecords.delete(nativeId);
          this.reached();
          this.emit("data");
        },
      },
      signal,
    );
  }

  async archiveScratchpad(input: ArchiveScratchpadInput) {
    const result = await this.startNewScratchpad(input);
    return { archived: result.previous, active: result.current };
  }

  private scratchImage(record: RecordView, remember = true): ScratchImage {
    const image = scratchImageFromRecord({
      path: record.path,
      revision: record.revision,
      types: record.types,
      frontmatter: record.frontmatter,
    });
    if (remember) {
      this.rememberWriteState(record);
      this.scratchRecords.set(`image:${image.id}`, record.id);
    }
    return image;
  }

  private async scratchImageRecords(
    signal: AbortSignal,
  ): Promise<RecordView[]> {
    const records: RecordView[] = [];
    const identities = new Set<string>();
    for await (const page of this.client.pages(
      { types: [SCRATCH_IMAGE_TYPE], limit: 1000 },
      { signal },
    )) {
      signal.throwIfAborted();
      if (!page.complete)
        throw nativeUnsupported(
          "The replica has not supplied complete Scratchpad image metadata.",
        );
      for (const record of page.records) {
        const image = this.scratchImage(record, false);
        if (identities.has(image.id))
          throw new Error(
            "Two native images have the same portable Scratchpad identity. Resolve the duplicate before opening this stream.",
          );
        identities.add(image.id);
        records.push(record);
      }
    }
    signal.throwIfAborted();
    for (const record of records) this.scratchImage(record);
    return records;
  }

  async listScratchFeed(
    request: ScratchFeedPageRequest = {},
  ): Promise<ScratchFeedPage> {
    const signal = this.signal();
    signal.throwIfAborted();
    if (!request.cursor || !this.scratchFeedSnapshot) {
      const current = await this.getActiveScratchpad();
      const revision = this.dataRevision;
      const records = await this.scratchpadRecords(signal);
      const images = await this.scratchImageRecords(signal);
      signal.throwIfAborted();
      const snapshot = {
        current,
        items: [
          ...records.map((record) =>
            scratchpadFeedItem(this.scratchpad(record)),
          ),
          ...images.map((record) => this.scratchImage(record)),
        ].filter((item) => item.kind === "image" || item.id !== current.id),
      };
      // A write can finish while either query is awaiting the authority. The
      // returned read is still an observed snapshot, but must not reinstall a
      // continuation that a newer data event already invalidated.
      if (revision === this.dataRevision) this.scratchFeedSnapshot = snapshot;
      return scratchFeedPage(snapshot.current, snapshot.items, request);
    }
    return scratchFeedPage(
      this.scratchFeedSnapshot.current,
      this.scratchFeedSnapshot.items,
      request,
    );
  }

  async getScratchImage(
    id: string,
    path?: string,
  ): Promise<ScratchImage | null> {
    const records = await this.scratchImageRecords(this.signal());
    const record = records.find(
      (record) =>
        this.scratchImage(record).id === id &&
        (path === undefined || record.path === path),
    );
    return record ? this.scratchImage(record) : null;
  }

  createScratchImage(input: CreateScratchImageInput): Promise<ScratchImage> {
    const signal = this.signal();
    const captured = structuredClone(input);
    let nativeId: string;
    return this.mutations.runRecord(
      {
        key: JSON.stringify(["scratch-image:create", captured]),
        recordIds: () => [nativeId],
        ack: (_, signal) =>
          this.readScratchWriteRecords(
            new Map([[nativeId, captured.id]]),
            "image",
            signal,
          ),
        prepare: async (mutationId, requestSignal) => {
          const fields = scratchImageFrontmatter(captured);
          // Validate the portable metadata before entering the submission boundary.
          scratchImageFromRecord({
            path: captured.path,
            revision: "",
            frontmatter: fields,
          });
          const records = await this.scratchImageRecords(requestSignal);
          if (
            records.some(
              (record) => this.scratchImage(record).id === captured.id,
            )
          )
            throw new Error("This Scratchpad image identity already exists.");
          nativeId = crypto.randomUUID();
          return () =>
            this.client.create(
              {
                id: nativeId,
                type: SCRATCH_IMAGE_TYPE,
                path: captured.path,
                frontmatter: fields,
                body: "",
              },
              { mutationId, signal: requestSignal },
            );
        },
        confirmed: async (_, requestSignal) => {
          const record = await this.client.get(nativeId, {
            signal: requestSignal,
          });
          requestSignal.throwIfAborted();
          if (record.id !== nativeId)
            throw new Error("The saved image's native identity changed.");
          this.requireUnprotectedRecord(record);
          const image = this.scratchImage(record);
          if (image.id !== captured.id)
            throw new Error(
              "The saved image's portable identity changed. Reload before continuing.",
            );
          this.reached();
          this.emit("data");
          return image;
        },
      },
      signal,
    );
  }

  removeScratchImage(
    input: Pick<ScratchImage, "id" | "path" | "revision">,
  ): Promise<void> {
    const signal = this.signal();
    const captured = structuredClone(input);
    let nativeId: string;
    return this.mutations.runRecord(
      {
        key: JSON.stringify(["scratch-image:remove", captured]),
        recordIds: () => [nativeId],
        ack: (_, signal) =>
          this.readScratchWriteRecords(
            new Map([[nativeId, captured.id]]),
            "image",
            signal,
          ),
        prepare: async (mutationId, requestSignal) => {
          const records = await this.scratchImageRecords(requestSignal);
          const record = records.find(
            (record) =>
              this.scratchImage(record).id === captured.id &&
              record.path === captured.path,
          );
          if (!record)
            throw new Error("The image feed record is no longer available.");
          this.requireUnprotectedRecord(record);
          nativeId = record.id;
          if (record.revision !== captured.revision)
            throw new Error(
              "This image record changed after it was opened. Reload it before removing.",
            );
          // Metadata membership only: never delete the independent binary asset.
          return () =>
            this.client.delete(record, {
              ifRevision: record.revision,
              mutationId,
              signal: requestSignal,
            });
        },
        confirmed: async (_, requestSignal) => {
          if (await this.client.find(nativeId, { signal: requestSignal }))
            throw new Error(
              "The original image metadata deletion is not visible in the native layer.",
            );
          requestSignal.throwIfAborted();
          this.conflictedRecords.delete(nativeId);
          this.reached();
          this.emit("data");
        },
      },
      signal,
    );
  }

  async people(extra?: AbortSignal) {
    const signal = this.signal(extra);
    if (!this.peopleClient)
      throw nativeUnsupported(
        "The selected collection's people service is unavailable.",
      );
    const directory = await this.peopleClient.directory({
      signal,
      members: "if-approved",
    });
    signal.throwIfAborted();
    return peopleView(directory);
  }

  async resolveAssignees(taskId: string, extra?: AbortSignal) {
    const signal = this.signal(extra);
    await this.loadIndex(signal);
    signal.throwIfAborted();
    const cached = this.cache.get(taskId);
    if (!cached) throw new Error("The task is no longer available.");
    const revision = this.dataRevision;
    const links = await resolveRecordLinks(
      this.client,
      {
        path: cached.task.path,
        field: cached.model.config.fieldMapping.assignees,
      },
      {
        signal,
        isCurrent: () =>
          !this.disposed &&
          revision === this.dataRevision &&
          this.cache.get(taskId)?.recordId === cached.recordId &&
          this.cache.get(taskId)?.task.path === cached.task.path,
      },
    );
    signal.throwIfAborted();
    return new Map(links.map(({ raw, path }) => [raw, path]));
  }

  private async assignedPaths(
    personPath?: string,
    signal: AbortSignal = this.signal(),
  ): Promise<Set<string> | undefined> {
    if (personPath === undefined) return undefined;
    // The person's backlinks come from the replica's link index, a page at a
    // time, so the cost follows the person's referrers rather than every task.
    // A query over the tasks would resolve each one's links under one request
    // budget and refuse large collections. Resolution is the replica's: exact
    // paths, never basenames.
    const fields = new Map(
      this.providers.map((provider) => [
        provider.typeName,
        provider.model.config.fieldMapping.assignees,
      ]),
    );
    const paths = new Set<string>();
    let cursor: string | undefined;
    do {
      let page: BacklinksResult;
      try {
        page = await this.client.backlinks(
          { path: personPath },
          { limit: 1000, signal, ...(cursor ? { cursor } : {}) },
        );
      } catch (reason) {
        // No person record: nothing is assigned to it.
        if (isMdbaseError(reason, "not_found")) return paths;
        throw reason;
      }
      signal.throwIfAborted();
      if (!page.complete)
        throw nativeUnsupported(
          "The replica has not supplied complete assignment matches.",
        );
      for (const { record, links } of page.backlinks) {
        const assigned = record.types.some((type) => {
          const field = fields.get(type);
          return (
            field !== undefined && links.some((link) => link.field === field)
          );
        });
        if (assigned) paths.add(record.path);
      }
      cursor = page.cursor;
    } while (cursor);
    return paths;
  }

  async search(query: TaskListQuery, options: { signal?: AbortSignal } = {}) {
    const signal = this.signal(options.signal);
    try {
      await this.ensureIndex();
      signal.throwIfAborted();
      const tokens = taskSearchTokens(query.search);
      const matches = new Map<string, Set<string>>();
      for (const token of tokens) {
        const ids = new Set<string>();
        for await (const page of this.client.pages(
          {
            types: [...this.models.keys()],
            where: `file.body.lower().contains(${JSON.stringify(token)})`,
            limit: 1000,
          },
          { signal },
        )) {
          signal.throwIfAborted();
          if (!page.complete)
            throw nativeUnsupported(
              "The replica has not supplied complete search matches.",
            );
          page.records.forEach((record) => ids.add(record.path));
        }
        matches.set(token, ids);
      }
      const paths = await this.assignedPaths(query.assignedTo, signal);
      signal.throwIfAborted();
      return this.cache
        .list(
          query,
          (task, token) => matches.get(token)?.has(task.path) ?? false,
          paths,
        )
        .map((task) => ({
          task,
          bodyMatches: tokens.filter((token) =>
            matches.get(token)?.has(task.path),
          ),
        }));
    } catch (reason) {
      if (
        this.noteOperationFailure(reason, signal) &&
        this.hasLoadedIndex &&
        query.assignedTo === undefined
      ) {
        // Previously loaded metadata is display-only while unavailable. It
        // cannot prove body/assignment matches or restore write availability.
        return this.cache
          .list(query)
          .map((task) => ({ task, bodyMatches: [] }));
      }
      throw reason;
    }
  }

  async list(
    query: TaskListQuery = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<Task[]> {
    const signal = this.signal(options.signal);
    signal.throwIfAborted();
    const selected = query.search?.trim()
      ? (await this.search(query, options)).map((r) => r.task)
      : await this.listSummaries(query);
    const out: Task[] = [];
    for (const task of selected) {
      signal.throwIfAborted();
      out.push((await this.current(task.id, signal)).task);
    }
    return out;
  }

  async get(id: string): Promise<Task | null> {
    const signal = this.signal();
    await this.ensureIndex();
    signal.throwIfAborted();
    if (!this.cache.has(id)) return null;
    return (await this.current(id, signal)).task;
  }

  async getSummary(id: string): Promise<TaskSummary | null> {
    const signal = this.signal();
    await this.ensureIndex();
    signal.throwIfAborted();
    const entry = this.cache.get(id);
    if (!entry) return null;
    const record = await this.client.find(entry.recordId, {
      include: { effective: true },
      signal,
    });
    signal.throwIfAborted();
    if (!record) {
      this.cache.delete(id);
      return null;
    }
    const decoded = this.decodeSummary(record);
    if (!decoded)
      throw new Error("The record no longer provides the task contract.");
    if (decoded.task.id !== id) this.cache.delete(id);
    const identity = this.cache.get(decoded.task.id);
    if (identity && identity.recordId !== record.id)
      throw new Error(
        "Two native records have the same portable TaskNotes identity.",
      );
    this.cache.set(decoded.task.id, decoded);
    if (decoded.task.id !== id)
      throw new Error(
        "The portable task identity changed. Refresh before continuing.",
      );
    return decoded.task;
  }

  /**
   * Answers from the last loaded metadata while a change notice waits for its
   * index read, so row markers do not blink out after each write.
   */
  taskRowRelations() {
    return this.hasLoadedIndex ? this.cache.rowRelations() : null;
  }

  async relationships(id: string) {
    const signal = this.signal();
    await this.ensureIndex();
    signal.throwIfAborted();
    return connectedTaskRelationships(this.cache.values(), id);
  }

  async completeField(request: FieldCompletionRequest) {
    const signal = this.signal();
    await this.ensureIndex();
    signal.throwIfAborted();
    if (request.kind === "values")
      return completeTaskValues(
        [...this.cache.values()].map((r) => r.task),
        request,
      );
    const text = request.query?.trim().toLowerCase();
    const result = await this.client.query(
      {
        ...(request.targetTypes?.length ? { types: request.targetTypes } : {}),
        ...(text
          ? {
              where: `file.path.lower().contains(${JSON.stringify(text)}) || ("title" in record && record.title.lower().contains(${JSON.stringify(text)}))`,
            }
          : {}),
        limit: Math.max(completionLimit(request) * 4, 48),
        order_by: [{ field: "file.path", direction: "asc" }],
      },
      { include: { effective: true }, signal },
    );
    signal.throwIfAborted();
    const records: CollectionRecord[] = result.records.map((r) => ({
      path: r.path,
      label: String((r.effective ?? r.frontmatter).title ?? r.path),
      frontmatter: r.effective ?? r.frontmatter,
      types: r.types,
    }));
    return usedValuesFirst(
      [...this.cache.values()].map((r) => r.task),
      request,
      completeRecords(
        records,
        request,
        this.providers[0]!.model.config.linkWriteFormat,
      ).map((completion) => {
        const task = completion.path
          ? this.cache.atPath(completion.path)?.task
          : undefined;
        return task ? { ...completion, taskId: task.id } : completion;
      }),
    );
  }

  async create(
    input: CreateTaskInput,
    intent: TaskCreateIntent = { id: crypto.randomUUID() },
  ): Promise<Task> {
    const owner = this.scope.signal;
    owner.throwIfAborted();
    const accepted = this.acceptedCreates.get(intent);
    if (accepted) {
      const refused = this.refusedWrite(intent.id);
      if (refused && refused.problem?.code !== "outcome_unknown")
        throw new RejectedNextMutation(refused.mutationId, refused.problem);
      const record = await this.client.get(intent.id, {
        include: { body: true, document: true, effective: true },
        signal: this.signal(),
      });
      owner.throwIfAborted();
      return this.remember(record);
    }
    await this.initialize({ deferTaskIndex: true });
    owner.throwIfAborted();
    let rollingWarnings: string[] = [];
    const task = await this.mutations
      .runRecord(
        {
          key: JSON.stringify(["task:create", intent.id]),
          ack: async (receipt, signal) => {
            await this.readCurrentWrites(
              [intent.id, ...(receipt.records ?? []).map((r) => r.id)],
              signal,
            );
            if (
              receipt.state === "confirmed" &&
              receipt.status === "applied" &&
              !receipt.conflicts?.length
            )
              delete intent.authorityRequestId;
          },
          requestId: intent.authorityRequestId,
          recordIds: () => [intent.id],
          prepare: async (mutationId, signal) => {
            const provider = this.providers[0]!;
            const task = await this.availableTaskPath(
              await provider.model.createWithTemplate(
                input,
                { id: intent.id },
                (path) => this.template(path, signal),
              ),
              signal,
            );
            const rolling = await this.rollingCreates(
              task,
              provider.model,
              provider.typeName,
              signal,
            );
            rollingWarnings = rolling.warnings;
            signal.throwIfAborted();
            return async () => {
              intent.authorityRequestId = mutationId;
              if (!rolling.ops.length)
                return this.client.create(
                  {
                    id: intent.id,
                    type: provider.typeName,
                    path: task.path,
                    frontmatter: task.frontmatter as Record<string, PlainValue>,
                    body: task.body,
                  },
                  {
                    mutationId,
                    signal,
                    wait: "pending",
                    include: { body: true, document: true, effective: true },
                  },
                );
              return this.client.submit(
                [
                  createRecordOp(intent.id, provider.typeName, task),
                  ...rolling.ops,
                ],
                {
                  mutationId,
                  signal,
                  wait: "pending",
                  include: { body: true, document: true, effective: true },
                },
              );
            };
          },
          confirmed: async (receipt, signal) => {
            const record = await this.client.get(intent.id, {
              include: { body: true, effective: true },
              signal,
            });
            signal.throwIfAborted();
            const saved = this.remember(record);
            if (
              receipt.state === "confirmed" &&
              receipt.status === "applied" &&
              !receipt.conflicts?.length
            )
              delete intent.authorityRequestId;
            if (saved.occurrenceMaterialization === "rolling")
              this.indexReady = false;
            return rollingWarnings.length
              ? { ...saved, operationWarnings: rollingWarnings }
              : saved;
          },
        },
        this.scope.signal,
      )
      .catch((reason: unknown) => {
        if (
          reason instanceof RejectedNextMutation &&
          reason.mutationId === intent.authorityRequestId
        )
          delete intent.authorityRequestId;
        throw reason;
      });
    owner.throwIfAborted();
    this.acceptedCreates.set(intent, task);
    this.emit("data");
    return task;
  }

  private async rollingCreates(
    parent: Task,
    model: TaskNotesTaskModel,
    typeName: string,
    signal: AbortSignal,
  ): Promise<{ ops: wire.Op[]; warnings: string[] }> {
    const ops: wire.Op[] = [];
    const warnings: string[] = [];
    let dates: string[];
    try {
      dates = rollingOccurrenceDates(parent);
    } catch (reason) {
      return {
        ops,
        warnings: [
          `rolling_occurrence_materialization_failed: ${reason instanceof Error ? reason.message : String(reason)}`,
        ],
      };
    }
    if (!dates.length) return { ops, warnings };
    await this.ensureIndex();
    signal.throwIfAborted();
    const existing = [...this.cache].map(([, entry]) => entry.task);
    // Occupancy includes the not-yet-submitted parent and sibling creates.
    const paths = new Set([parent.path]);
    const now = new Date().toISOString();
    for (const date of dates) {
      const id = await occurrenceRecordId(parent.id, date);
      signal.throwIfAborted();
      const result = await model.materializeOccurrence(
        parent,
        date,
        existing,
        { id, now },
        (path) => this.template(path, signal),
      );
      warnings.push(...result.warnings);
      if (!result.created) continue;
      const task = await this.availableTaskPath(result.task, signal, paths);
      paths.add(task.path);
      ops.push(createRecordOp(id, typeName, task));
    }
    return { ops, warnings };
  }

  private async availableTaskPath(
    task: Task,
    signal: AbortSignal,
    plannedPaths: ReadonlySet<string> = new Set(),
  ): Promise<Task> {
    for (const path of taskPathCandidates(task.path)) {
      if (plannedPaths.has(path)) continue;
      const occupied = await this.client.find({ path }, { signal });
      signal.throwIfAborted();
      if (!occupied) return path === task.path ? task : { ...task, path };
    }
    throw new Error(
      "task_path_collision: Could not allocate a unique task path.",
    );
  }

  private async template(path: string, signal: AbortSignal): Promise<string> {
    const record = await this.client.get(
      { path },
      { include: { document: true }, signal },
    );
    signal.throwIfAborted();
    if (record.document === undefined)
      throw new Error("The replica did not supply the template source.");
    return record.document;
  }

  private mutateTask(
    id: string,
    key: string,
    mutate: (task: Task, model: TaskNotesTaskModel) => Task,
  ): Promise<Task> {
    let recordId: string | undefined = this.cache.get(id)?.recordId;
    let rollingWarnings: string[] = [];
    return this.mutations.runRecord(
      {
        key,
        recordIds: () => (recordId ? [recordId] : []),
        prepare: async (mutationId, signal) => {
          const current = await this.current(id, signal);
          recordId = current.record.id;
          const next = mutate(current.task, current.model);
          if (next === current.task) return { value: current.task };
          const rolling = await this.rollingCreates(
            next,
            current.model,
            this.cache.get(id)!.typeName,
            signal,
          );
          rollingWarnings = rolling.warnings;
          if (!rolling.ops.length)
            return () =>
              this.client.update(
                current.record,
                taskChanges(current.record, current.task, next),
                {
                  mutationId,
                  signal,
                  wait: "pending",
                  include: { body: true, document: true, effective: true },
                },
              );
          const ops = [
            this.client.updateOp(
              current.record,
              taskChanges(current.record, current.task, next),
            ),
            ...rolling.ops,
          ];
          return async () =>
            this.client.submit(ops, {
              mutationId,
              signal,
              wait: "pending",
              include: { body: true, document: true, effective: true },
            });
        },
        confirmed: async (_receipt, signal) => {
          if (!recordId)
            throw new Error(
              "The confirmed task identity cannot be resolved. Refresh before continuing.",
            );
          const record = await this.client.get(recordId, {
            include: { body: true, effective: true },
            signal,
          });
          signal.throwIfAborted();
          const task = this.remember(record);
          if (task.occurrenceMaterialization === "rolling")
            this.indexReady = false;
          this.emit("data");
          return rollingWarnings.length
            ? { ...task, operationWarnings: rollingWarnings }
            : task;
        },
      },
      this.scope.signal,
    );
  }

  editCalendar(id: string, edit: CalendarTaskEdit) {
    return this.mutateTask(
      id,
      JSON.stringify(["task:calendar", id, edit]),
      (task, model) => model.editCalendar(task, edit),
    );
  }

  update(
    id: string,
    input: UpdateTaskInput,
    options: { expectedRevision?: number } = {},
  ) {
    return this.mutateTask(
      id,
      JSON.stringify([
        "task:update",
        id,
        input,
        ...(options.expectedRevision === undefined
          ? []
          : [options.expectedRevision]),
      ]),
      (task, model) => {
        if (
          options.expectedRevision !== undefined &&
          task.revision !== options.expectedRevision
        )
          throw new TaskRevisionChangedError(
            "The task changed after creation.",
          );
        return model.update(task, input, { now: new Date().toISOString() });
      },
    );
  }
  async updateMany(updates: readonly { id: string; input: UpdateTaskInput }[]) {
    const out: Task[] = [];
    for (const update of updates)
      out.push(await this.update(update.id, update.input));
    return out;
  }

  toggle(
    id: string,
    occurrenceDate?: string,
    completed?: boolean,
  ): Promise<Task> {
    return this.transitionTask(id, "toggle", occurrenceDate, completed);
  }

  skip(id: string, occurrenceDate: string): Promise<Task> {
    return this.transitionTask(id, "skip", occurrenceDate);
  }

  private transitionTask(
    id: string,
    action: "toggle" | "skip",
    occurrenceDate?: string,
    completed?: boolean,
  ): Promise<Task> {
    const targets: string[] = [];
    const warnings: string[] = [];
    return this.mutations.runRecord(
      {
        recordIds: () => targets,
        key: JSON.stringify([
          "task:transition",
          id,
          action,
          occurrenceDate,
          completed,
        ]),
        prepare: async (mutationId, signal) => {
          const current = await this.current(id, signal);
          const now = new Date().toISOString();
          targets.push(current.record.id);
          const ops: wire.Op[] = [];
          if (current.task.recurrenceParent && current.task.occurrenceDate) {
            const summaries = [...this.cache.values()].map(
              (entry) => entry.task,
            );
            const reference = findOccurrenceParent(summaries, current.task);
            if (!reference || reference.id === id)
              throw new Error(
                "invalid_recurrence_parent: The occurrence parent could not be resolved.",
              );
            const parent = await this.current(reference.id, signal);
            if (
              this.cache.get(id)!.typeName !==
              this.cache.get(reference.id)!.typeName
            )
              throw new Error(
                "A materialized occurrence and its parent must use the same TaskNotes implementation type.",
              );
            if (
              action === "toggle" &&
              completed !== undefined &&
              current.task.completed === completed
            )
              return { value: current.task };
            const transition = parent.model.transitionMaterializedOccurrence(
              current.task,
              parent.task,
              action,
              { now },
            );
            targets.push(parent.record.id);
            ops.push(
              this.client.updateOp(
                current.record,
                taskChanges(
                  current.record,
                  current.task,
                  transition.occurrence,
                ),
              ),
              this.client.updateOp(
                parent.record,
                taskChanges(parent.record, parent.task, transition.parent),
              ),
            );
            if (transition.materializeNextDate) {
              const nextId = await occurrenceRecordId(
                parent.task.id,
                transition.materializeNextDate,
              );
              const existing = summaries.filter(
                (task) =>
                  findOccurrenceParent([parent.task], task)?.id ===
                  parent.task.id,
              );
              const next = await parent.model.materializeOccurrence(
                transition.parent,
                transition.materializeNextDate,
                existing,
                { id: nextId, now },
                (path) => this.template(path, signal),
              );
              warnings.push(...next.warnings);
              if (next.created) {
                const task = await this.availableTaskPath(next.task, signal);
                targets.push(nextId);
                ops.push(
                  createRecordOp(
                    nextId,
                    this.cache.get(reference.id)!.typeName,
                    task,
                  ),
                );
              }
            }
          } else {
            if (
              action === "toggle" &&
              completed !== undefined &&
              taskCompletion(current.task, occurrenceDate) === completed
            )
              return { value: current.task };
            const next =
              action === "toggle"
                ? current.model.toggle(current.task, {
                    now,
                    currentDate: occurrenceDate,
                  })
                : current.model.skip(current.task, {
                    now,
                    currentDate: occurrenceDate,
                  });
            ops.push(
              this.client.updateOp(
                current.record,
                taskChanges(current.record, current.task, next),
              ),
            );
          }
          signal.throwIfAborted();
          // Related task updates and the requested next occurrence are one atomic
          // native mutation, not a partially acknowledged multi-request cascade.
          return async () =>
            this.client.submit(ops, {
              mutationId,
              signal,
              wait: "pending",
              include: { body: true, document: true, effective: true },
            });
        },
        confirmed: async (_receipt, signal) => {
          const records = await Promise.all(
            targets.map((recordId) =>
              this.client.get(recordId, {
                include: { body: true, effective: true },
                signal,
              }),
            ),
          );
          signal.throwIfAborted();
          const tasks = records.map((record) => this.remember(record));
          if (!tasks[0])
            throw new Error(
              "The original native transition target was not retained.",
            );
          this.emit("data");
          return warnings.length
            ? { ...tasks[0], operationWarnings: warnings }
            : tasks[0];
        },
      },
      this.scope.signal,
    );
  }
  async materializeOccurrence(
    parentId: string,
    occurrenceDate: string,
    overrides?: OccurrenceOverrides,
  ): Promise<MaterializeOccurrenceResult> {
    const owner = this.scope.signal;
    owner.throwIfAborted();
    const recordId = await occurrenceRecordId(parentId, occurrenceDate);
    owner.throwIfAborted();
    let warnings: string[] = [];
    return this.mutations.runRecord<MaterializeOccurrenceResult>(
      {
        recordIds: () => [recordId],
        key: JSON.stringify(["task:materialize", parentId, occurrenceDate]),
        prepare: async (mutationId, signal) => {
          const parent = await this.current(parentId, signal);
          const existing = [...this.cache.values()]
            .map((value) => value.task)
            .filter(
              (task) =>
                findOccurrenceParent([parent.task], task)?.id === parentId,
            );
          const result = await parent.model.materializeOccurrence(
            parent.task,
            occurrenceDate,
            existing,
            { id: recordId, now: new Date().toISOString(), overrides },
            (path) => this.template(path, signal),
          );
          if (!result.created)
            return {
              value: {
                ...result,
                task: (await this.current(result.task.id, signal)).task,
              },
            };
          const created = await this.availableTaskPath(result.task, signal);
          warnings = result.warnings;
          return () =>
            this.client.create(
              {
                id: recordId,
                type: this.cache.get(parentId)!.typeName,
                path: created.path,
                frontmatter: created.frontmatter as Record<string, PlainValue>,
                body: created.body,
              },
              {
                mutationId,
                signal,
                wait: "pending",
                include: { body: true, document: true, effective: true },
              },
            );
        },
        confirmed: async (_r, signal) => {
          const record = await this.client.get(recordId, {
            include: { body: true, effective: true },
            signal,
          });
          signal.throwIfAborted();
          const task = this.remember(record);
          this.emit("data");
          return { task, created: true, warnings };
        },
      },
      this.scope.signal,
    );
  }
  startTimeTracking(id: string, description?: string) {
    return this.mutateTask(
      id,
      JSON.stringify(["task:track", id, description]),
      (task, model) =>
        model.startTimeTracking(task, {
          now: new Date().toISOString(),
          description,
        }),
    );
  }
  stopTimeTracking(id: string) {
    return this.mutateTask(
      id,
      JSON.stringify(["task:stop", id]),
      (task, model) =>
        model.stopTimeTracking(task, { now: new Date().toISOString() }),
    );
  }
  replaceTimeEntries(id: string, entries: TaskTimeEntry[]) {
    return this.mutateTask(
      id,
      JSON.stringify(["task:entries", id, entries]),
      (task, model) =>
        model.replaceTimeEntries(task, entries, {
          now: new Date().toISOString(),
        }),
    );
  }
  removeTimeEntry(id: string, index: number) {
    return this.mutateTask(
      id,
      JSON.stringify(["task:remove-entry", id, index]),
      (task, model) =>
        model.removeTimeEntry(task, index, { now: new Date().toISOString() }),
    );
  }
  async setArchived(id: string, archived: boolean): Promise<Task> {
    let recordId: string | undefined;
    return this.mutations.runRecord(
      {
        recordIds: () => (recordId ? [recordId] : []),
        key: JSON.stringify(["task:archive", id, archived]),
        prepare: async (mutationId, signal) => {
          const current = await this.current(id, signal);
          recordId = current.record.id;
          const next = current.model.update(
            current.task,
            { archived },
            { now: new Date().toISOString() },
          );
          const destination = current.model.archiveDestination(next, archived);
          const ops: wire.Op[] = [
            this.client.updateOp(
              current.record,
              taskChanges(current.record, current.task, next),
            ),
          ];
          if (destination && destination !== current.record.path)
            ops.push({
              kind: "rename",
              id: current.record.id,
              from: current.record.path,
              to: destination,
              updateRefs: true,
            });
          // One atomic mutation; a retry cannot repeat the archive patch before
          // recovering an uncertain rename. The update carries the observed CAS.
          return async () =>
            this.client.submit(ops, {
              mutationId,
              signal,
              wait: "pending",
              include: { body: true, document: true, effective: true },
            });
        },
        confirmed: async (_r, signal) => {
          if (!recordId)
            throw new Error(
              "The archived native record identity was not retained.",
            );
          const record = await this.client.get(recordId, {
            include: { body: true, effective: true },
            signal,
          });
          signal.throwIfAborted();
          const saved = this.remember(record);
          this.emit("data");
          return saved;
        },
      },
      this.scope.signal,
    );
  }
  async delete(
    id: string,
    options: { authorityRequestId?: string; expectedRevision?: number } = {},
  ): Promise<void> {
    const owner = this.scope.signal;
    try {
      owner.throwIfAborted();
      await this.ensureIndex();
      owner.throwIfAborted();
    } catch (reason) {
      if (
        !options.authorityRequestId &&
        owner.aborted &&
        reason === owner.reason
      )
        throw new TaskDeletionNotStartedError(
          "Deletion paused before submission.",
          {
            cause: reason,
          },
        );
      throw reason;
    }
    if (!this.cache.has(id) && !options.authorityRequestId) return;
    let recordId = this.cache.get(id)?.recordId;
    if (options.authorityRequestId) {
      const original = await this.ledgerRecords(
        options.authorityRequestId,
        owner,
      );
      recordId = original.length === 1 ? original[0] : undefined;
    }
    await this.mutations.runRecord(
      {
        recordIds: () => (recordId ? [recordId] : []),
        key: JSON.stringify(["task:delete", id]),
        requestId: options.authorityRequestId,
        prepare: async (mutationId, signal) => {
          const current = await this.current(id, signal);
          if (
            options.expectedRevision !== undefined &&
            current.task.revision !== options.expectedRevision
          )
            throw new TaskRevisionChangedError(
              "The task changed after creation.",
            );
          recordId = current.record.id;
          return () =>
            this.client.delete(current.record, {
              ifRevision: current.record.revision,
              mutationId,
              signal,
              wait: "pending",
            });
        },
        confirmed: async (_receipt, signal) => {
          if (!recordId)
            throw new Error(
              "The original deletion identity is unavailable; preserve its recovery request.",
            );
          const record = await this.client.find(recordId, { signal });
          signal.throwIfAborted();
          if (record)
            throw new Error(
              "The original native record is still present after deletion.",
            );
          if (this.cache.get(id)?.recordId === recordId) this.cache.delete(id);
          this.conflictedRecords.delete(recordId);
          this.emit("data");
        },
      },
      this.scope.signal,
    );
  }

  todayTaskCounts(today: string) {
    return this.indexReady ? this.cache.todayCounts(today) : null;
  }

  projectShortcuts() {
    return this.indexReady
      ? projectShortcuts([...this.cache.values()].map(({ task }) => task))
      : [];
  }

  /**
   * Unlike the counts, this keeps answering from the last loaded metadata
   * while a change notice waits for its index read: a timer that vanished
   * between those two would look stopped.
   */
  runningTimers() {
    return this.hasLoadedIndex
      ? runningTimers([...this.cache.values()].map(({ task }) => task))
      : null;
  }

  navigationTaskCounts(today: string) {
    return this.indexReady
      ? navigationTaskCounts(
          [...this.cache.values()].map(({ task }) => task),
          today,
        )
      : null;
  }

  async stats() {
    const signal = this.signal();
    await this.ensureIndex();
    signal.throwIfAborted();
    return connectedTaskStats(this.cache.values());
  }
  async taskConfiguration() {
    const signal = this.signal();
    await this.initialize({ deferTaskIndex: true });
    signal.throwIfAborted();
    // Capture still uses the primary provider's defaults. The collection-wide
    // settings port has no provider selector; do not imply those settings can
    // safely edit an arbitrary first type in a multi-provider collection.
    return this.providers[0]!.model.configuration();
  }
  async taskModelSettingsAccess() {
    const signal = this.signal();
    await this.initialize({ deferTaskIndex: true });
    signal.throwIfAborted();
    if (this.providers.length !== 1)
      return {
        writable: false as const,
        source: "Multiple task type definitions",
        reason:
          "This collection has several task types. Edit each type's settings in mdbase.",
      };
    const source = this.providers[0]!.sourcePath;
    if (!this.client.hello.grant.capabilities.includes("definitions.manage"))
      return {
        writable: false as const,
        source,
        reason: "Task model settings need definition management access.",
      };
    try {
      await this.client.resources.get(source, { signal });
      signal.throwIfAborted();
      return {
        writable: true as const,
        source,
        appSettings: appSettingsAccess(
          this.settingsType,
          this.settings.getSnapshot(),
        ),
      };
    } catch (reason) {
      if (reason instanceof MdbaseError && reason.code === "forbidden")
        return {
          writable: false as const,
          source,
          reason: "Task model settings need definition access.",
        };
      throw reason;
    }
  }
  async updateTaskModelSettings(patch: TaskModelSettingsPatch) {
    const owner = this.scope.signal;
    owner.throwIfAborted();
    await this.initialize({ deferTaskIndex: true });
    owner.throwIfAborted();
    if (this.providers.length !== 1)
      throw new Error(
        "This collection has several task types. Edit each type's settings in mdbase.",
      );
    const source = this.providers[0]!.sourcePath;
    const split = splitTaskModelSettingsPatch(
      patch,
      this.providers[0]!.model.configuration(),
    );
    const typePatch = split.type;
    if (typePatch.statuses || typePatch.priorities) {
      // A status or priority tasks still hold stays until they are moved off
      // it: removing it would put those tasks outside the type's schema.
      await this.ensureIndex();
      owner.throwIfAborted();
      const current = this.providers[0]!.model.configuration();
      const inUse = taskNotesVocabularyInUse(
        [...this.cache.values()].map(({ task }) => task),
        {
          statuses: current.statuses.map(({ value }) => value),
          priorities: current.priorities.map(({ value }) => value),
        },
        typePatch,
      );
      if (inUse) throw inUse;
    }
    // App behaviour goes to the settings record, never to the binding. It is
    // saved first: a conflict there stops the save before anything is written.
    if (Object.keys(split.app).length) {
      const prepared = await this.settings.current(this.signal());
      const access = appSettingsAccess(this.settingsType, prepared);
      if (!access.writable) throw new Error(access.reason);
      await saveAppSettings(
        this.settings,
        taskNotesSettingsChanges(split.app, prepared.frontmatter),
        prepared,
      );
      this.invalidateRemoteData();
      await this.initialize({ deferTaskIndex: true });
      owner.throwIfAborted();
    }
    await this.mutations.run(
      {
        key: JSON.stringify(["task:settings", typePatch]),
        prepare: async (mutationId, signal) => {
          const providers = await nextTaskProviders(this.client, signal);
          if (providers.length !== 1 || providers[0]!.sourcePath !== source)
            throw new Error(
              "Task type selection changed. Reload before editing its settings.",
            );
          const resource = await this.client.resources.get(source, { signal });
          if (resource.text === undefined)
            throw new Error("The replica did not supply the task type source.");
          const parsed = parseFrontmatter(resource.text);
          const patched = patchTaskNotesMdbaseTypeSettings(
            parsed.frontmatter,
            typePatch,
          );
          // Nothing the type keeps changed: leave its revision alone.
          if (serializeMarkdownDocument(patched, parsed.body) === resource.text)
            return { value: undefined };
          // The type is being written anyway, so it leaves with one
          // vocabulary: a hand edit can make its schema and its binding
          // list different statuses, and the authority then refuses tasks
          // the app offers.
          const text = serializeMarkdownDocument(
            reconcileTaskNotesMdbaseTypeVocabulary(patched),
            parsed.body,
          );
          return () =>
            this.client.resources.put(source, text, {
              baseRevision: resource.revision,
              mutationId,
              signal,
            });
        },
        confirmed: async (_r, signal) => {
          const providers = await nextTaskProviders(this.client, signal, {
            settings: this.settings.getSnapshot().frontmatter,
          });
          signal.throwIfAborted();
          this.providers = providers;
          this.models = new Map(providers.map((p) => [p.typeName, p.model]));
          this.indexReady = false;
        },
      },
      this.scope.signal,
    );
    this.emit("data");
    return this.taskConfiguration();
  }

  async cachedViews() {
    return structuredClone(this.viewCatalog);
  }
  async listViews(): Promise<TaskViewDocument[]> {
    return this.discoverNativeViews(this.signal());
  }
  /** The replica keeps ONE discovery cursor per session, and a new discovery
   * replaces it: the older pass's next page is refused as stale. Discovery
   * also pages through every record, so on a relayed collection one pass is
   * many round trips. Overlapping callers (navigation, its refresh when the
   * change watch starts, a view execution after invalidation) therefore join
   * the pass in flight rather than retiring each other until the foreground
   * budget expires (#449). A joined pass stays current: every local data
   * event retires its cut and it rereads before it resolves. */
  private async discoverNativeViews(
    signal: AbortSignal,
  ): Promise<TaskViewDocument[]> {
    for (;;) {
      signal.throwIfAborted();
      if (!this.discovery) {
        const pending = this.runNativeDiscovery(signal).finally(() => {
          if (this.discovery?.pending === pending) this.discovery = null;
        });
        this.discovery = { pending, signal };
      }
      const run = this.discovery;
      try {
        const catalog = await untilAborted(run.pending, signal);
        signal.throwIfAborted();
        return structuredClone(catalog);
      } catch (reason) {
        signal.throwIfAborted();
        // A shared pass belongs to its initiating caller. Only that caller's
        // abort lets another caller start a pass under its own deadline;
        // refusals and channel loss reach every caller unchanged.
        if (
          !run.signal.aborted ||
          (reason !== run.signal.reason &&
            (!(reason instanceof MdbaseError) || reason.code !== "cancelled"))
        )
          throw reason;
        if (this.discovery === run) this.discovery = null;
      }
    }
  }
  private async runNativeDiscovery(
    signal: AbortSignal,
  ): Promise<TaskViewDocument[]> {
    return this.readCurrentGeneration(signal, async () => {
      await this.initializeModel(signal);
      const revision = this.dataRevision;
      const descriptors = new Map<string, AppBasesDescriptor>();
      const documents = new Map<string, TaskViewDocument>();
      const timezone = runtimeTimezone();
      for await (const views of iterateNativeDiscovery(async (continuation) => {
        const result = await this.client.listAppBasesViews(
          { captureTimezone: timezone, limit: 128, continuation },
          { signal },
        );
        if (result.kind === "refusal") throw new MdbaseError(result.problem);
        return result;
      }, signal)) {
        this.assertCurrentData(revision);
        for (const descriptor of views) {
          const key = taskViewKey(
            descriptor.record,
            String(descriptor.ordinal),
          );
          descriptors.set(key, structuredClone(descriptor));
          this.sourceRecords.set(descriptor.path, descriptor.record);
          let document = documents.get(descriptor.record);
          if (!document) {
            document = {
              id: descriptor.record,
              name: descriptor.path,
              source: {
                path: descriptor.path,
                revision: descriptor.sourceRevision,
                format: "obsidian.base",
                writable: this.hasViewSourceGrant("records.edit"),
              },
              views: [],
            };
            documents.set(descriptor.record, document);
          }
          document.views.push({
            key,
            declaration: {
              recordId: descriptor.record,
              path: descriptor.path,
              revision: descriptor.sourceRevision,
              ordinal: descriptor.ordinal,
              name: descriptor.name,
            },
            documentId: descriptor.record,
            documentName: descriptor.path,
            id: String(descriptor.ordinal),
            name: descriptor.name ?? "",
            properties: [],
            source: { ...document.source },
            presentation: {
              type: normalizePresentationType(descriptor.viewType),
              mappings: {},
              options: {},
            },
          });
        }
      }
      signal.throwIfAborted();
      this.assertCurrentData(revision);
      this.nativeViews = descriptors;
      this.viewCatalog = [...documents.values()];
      const live = new Set(
        this.viewCatalog.flatMap((document) =>
          document.views.map((view) => view.key),
        ),
      );
      for (const key of this.viewExecutions.keys())
        if (!live.has(key)) this.viewExecutions.delete(key);
      return this.viewCatalog;
    });
  }
  private viewExecutionSignature(view: TaskView, timezone: string): string {
    return JSON.stringify([timezone, view]);
  }
  async cachedViewExecution(view: TaskView): Promise<TaskViewExecution | null> {
    this.signal().throwIfAborted();
    const slot = this.viewExecutions.get(view.key);
    if (
      !slot?.execution ||
      slot.signature !== this.viewExecutionSignature(view, runtimeTimezone())
    )
      return null;
    // Cached rows are display-only; they never certify a live native cut or
    // permit manual ordering while the new execution is being loaded.
    return { ...structuredClone(slot.execution), stale: true };
  }
  private nativeSourceDescriptor(path: string): AppBasesDescriptor {
    const matches = [...this.nativeViews.values()].filter(
      (view) => view.path === path,
    );
    const descriptor = matches[0];
    if (!descriptor)
      throw nativeUnsupported(
        "Refresh the native view catalog before reading this source.",
      );
    if (
      matches.some(
        (view) =>
          view.record !== descriptor.record ||
          view.sourceRevision !== descriptor.sourceRevision,
      )
    )
      throw new Error("Native view path has ambiguous source identities.");
    return structuredClone(descriptor);
  }
  private nativeSourceId(path: string): string | undefined {
    // Discovery ambiguity still refuses writes. A remembered actual record is
    // used only when its obsolete descriptors were cleared by our local edit.
    if ([...this.nativeViews.values()].some((view) => view.path === path))
      return this.nativeSourceDescriptor(path).record;
    return this.sourceRecords.get(path);
  }
  private async readNativeSource(
    descriptor: AppBasesDescriptor,
    signal: AbortSignal,
    timezone = runtimeTimezone(),
  ) {
    signal.throwIfAborted();
    await this.initialize({ deferTaskIndex: true });
    const revision = this.dataRevision;
    const result = await this.client.readAppBasesViewSource(
      { ...nativeViewSelection(descriptor), captureTimezone: timezone },
      { signal },
    );
    if (result.kind === "refusal") throw new MdbaseError(result.problem);
    if (
      result.view.record !== descriptor.record ||
      result.view.path !== descriptor.path ||
      result.view.sourceRevision !== descriptor.sourceRevision ||
      result.view.ordinal !== descriptor.ordinal
    )
      throw new Error("Native view READ changed its selected source identity.");
    signal.throwIfAborted();
    this.assertCurrentData(revision);
    return result;
  }
  private hasViewSourceGrant(capability: "records.edit" | "records.delete") {
    const grant = this.client.hello.grant;
    return (
      grant.role !== "viewer" &&
      grant.capabilities.includes("collection.read") &&
      grant.capabilities.includes(capability) &&
      grant.fileFolders === undefined
    );
  }
  private requireViewSourceGrant(
    capability: "records.edit" | "records.delete",
  ) {
    if (!this.hasViewSourceGrant(capability))
      throw nativeUnsupported(
        "This session does not provide the required full-scope view-source grant.",
      );
  }
  private forgetNativeSource(record: string) {
    this.viewCatalog = this.viewCatalog.filter(
      (document) => document.id !== record,
    );
    for (const [key, descriptor] of this.nativeViews) {
      if (descriptor.record === record) this.nativeViews.delete(key);
    }
    this.emit("data");
  }
  private nativeView(view: TaskView): AppBasesDescriptor {
    const descriptor = this.nativeViews.get(view.key);
    if (
      !descriptor ||
      descriptor.record !== view.documentId ||
      String(descriptor.ordinal) !== view.id ||
      descriptor.path !== view.source.path ||
      descriptor.sourceRevision !== view.source.revision ||
      (view.declaration !== undefined &&
        (view.declaration.recordId !== descriptor.record ||
          view.declaration.path !== descriptor.path ||
          view.declaration.revision !== descriptor.sourceRevision ||
          view.declaration.ordinal !== descriptor.ordinal ||
          view.declaration.name !== descriptor.name))
    )
      throw nativeUnsupported(
        "Refresh the native view catalog before selecting this source.",
      );
    return structuredClone(descriptor);
  }
  private async executeNativeView(
    view: TaskView,
    signal: AbortSignal,
    window?: AppBasesWindow,
    repairDefaults = true,
  ): Promise<TaskViewExecution> {
    return this.readCurrentGeneration(signal, async () => {
      await this.initializeModel(signal);
      signal.throwIfAborted();
      // A data push can invalidate discovery before the selected view reloads.
      // Rediscover through the original client, then enforce the same exact
      // source identity; never execute a retained descriptor as a stale fallback.
      if (!this.nativeViews.has(view.key))
        await this.discoverNativeViews(signal);
      signal.throwIfAborted();
      const revision = this.dataRevision;
      const descriptor = this.nativeView(view);
      const timezone = runtimeTimezone();
      const signature = this.viewExecutionSignature(view, timezone);
      const previous = this.viewExecutions.get(view.key);
      const slot = {
        signature,
        execution:
          previous?.signature === signature ? previous.execution : null,
      };
      this.viewExecutions.set(view.key, slot);
      const selected = await this.readNativeSource(
        descriptor,
        signal,
        timezone,
      );
      this.assertCurrentData(revision);
      const result = await this.client.executeAppBases(
        {
          ...nativeViewSelection(descriptor),
          hints: new Map(),
          captureTimezone: timezone,
          ...(window === undefined ? {} : { window }),
        },
        { signal },
      );
      if (result.kind === "refusal") {
        if (
          repairDefaults &&
          result.problem.reason === "view_unsupported_construct" &&
          result.problem.message === "base_display_order_missing" &&
          view.presentation?.type.startsWith("tasknotes.") &&
          this.hasViewSourceGrant("records.edit") &&
          view.declaration
        ) {
          const document = materializeDefaultViewOrder(
            {
              ...view.source,
              recordId: descriptor.record,
              format: "obsidian.base",
              document: selected.source,
            },
            view.declaration,
          );
          if (document !== null) {
            await this.updateViewSource(
              {
                path: descriptor.path,
                document,
                ifRevision: descriptor.sourceRevision,
              },
              true,
            );
            const documents = await this.discoverNativeViews(signal);
            const refreshed = documents
              .flatMap((document) => document.views)
              .find((candidate) => candidate.key === view.key);
            if (refreshed)
              return this.executeNativeView(refreshed, signal, window, false);
          }
        }
        throw new MdbaseError(result.problem);
      }
      if (
        result.view.record !== descriptor.record ||
        result.view.sourceRevision !== descriptor.sourceRevision ||
        result.view.ordinal !== descriptor.ordinal ||
        result.view.path !== descriptor.path
      )
        throw new Error(
          "Native execution changed its selected source identity.",
        );
      const metadata = nativePresentation(
        selected.source,
        result.view,
        result.columns,
      );
      if (result.groups.length && metadata.groupProperty === undefined)
        throw nativeUnsupported(
          "The native grouped view did not declare its group property.",
        );
      const values = nativeRowValues(
        result.columns,
        result.rows,
        result.groups,
        metadata.groupProperty,
      );
      const records = await readNativeRows(
        result.rows,
        (id, current) =>
          this.client.get(id, {
            include: { effective: true },
            signal: current,
          }),
        signal,
      );
      signal.throwIfAborted();
      this.assertCurrentData(revision);
      const totalCount = result.window?.totalMatchedRows ?? result.rows.length;
      let rowIndex = 0;
      const normalized = normalizeViewExecution(
        {
          ...view,
          properties: metadata.properties,
          presentation: metadata.presentation,
        },
        {
          results: records.map((record, index) => ({
            path: record.path,
            effectiveFrontmatter: record.effective ?? record.frontmatter,
            types: [...record.types],
            values: values[index]!,
          })),
          meta: {
            totalCount,
            hasMore:
              result.window !== undefined &&
              result.window.offset + result.rows.length < totalCount,
            groups: result.groups.map((group, index) => ({
              values: { [metadata.groupProperty!]: nativeCellValue(group.key) },
              count:
                result.window?.groupPlacements[index]?.totalGroupRows ??
                group.rowIndices.length,
              summaries: {},
            })),
          },
        },
        () => nextTaskSummary(records[rowIndex++]!, this.models),
      );
      if (this.viewExecutions.get(view.key) === slot) {
        slot.execution = structuredClone(normalized);
        this.viewExecutions.set(view.key, slot);
      }
      return normalized;
    });
  }
  async executeView(view: TaskView): Promise<TaskViewExecution> {
    return this.executeNativeView(view, this.signal());
  }
  async *iterateView(
    view: TaskView,
    options: { signal?: AbortSignal; cumulative?: boolean } = {},
  ): AsyncIterable<TaskViewExecution> {
    const signal = this.signal(options.signal);
    if (!options.cumulative) {
      yield await this.executeNativeView(view, signal);
      return;
    }
    const first = await this.executeNativeView(view, signal, {
      offset: 0,
      limit: 200,
    });
    yield first;
    if (first.hasMore) {
      // Independent window requests are not leases. Replace, never append a
      // different cut: the full-load result is one complete native execution.
      yield await this.executeNativeView(view, signal);
    }
  }
  async readViewSource(path: string): Promise<TaskViewSourceDocument> {
    const result = await this.readNativeSource(
      this.nativeSourceDescriptor(path),
      this.signal(),
    );
    return {
      recordId: result.view.record,
      path: result.view.path,
      format: "obsidian.base",
      revision: result.view.sourceRevision,
      document: result.source,
    };
  }
  async createViewSource(
    input: CreateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument> {
    this.signal().throwIfAborted();
    const format =
      input.format ??
      (input.path ? viewSourceFormat(input.path) : "obsidian.base");
    const path =
      input.path ?? newViewSourcePath(format, input.name ?? "New view");

    if (
      format !== "obsidian.base" ||
      viewSourceFormat(path) !== "obsidian.base"
    )
      throw nativeUnsupported(
        "This native session supports only obsidian.base view sources.",
      );
    const document = input.document;
    viewSourceRecord(path, document);
    let recordId: string | undefined;
    const read = async (_receipt: Receipt, signal: AbortSignal) => {
      if (!recordId)
        throw new Error("The original native source identity is unavailable.");
      const record = await this.client.views.getSourceRecord(recordId, {
        signal,
      });
      signal.throwIfAborted();
      if (record.id !== recordId)
        throw new Error(
          "The native source READ changed its original record identity.",
        );
      return this.sourceDocument(record, path);
    };
    return this.mutations.run(
      {
        key: JSON.stringify(["view:create", path, document]),
        recordIds: () => (recordId ? [recordId] : []),
        prepare: async (mutationId, signal) => {
          this.requireViewSourceGrant("records.edit");
          if (await this.client.find({ path }, { signal }))
            throw new Error("A record already occupies this view source path.");
          signal.throwIfAborted();
          this.requireViewSourceGrant("records.edit");
          recordId = crypto.randomUUID();
          const id = recordId;
          return () =>
            this.client.views.createSource(
              { id, path, document },
              { mutationId, signal, wait: "pending" },
            );
        },
        local: async (receipt, signal) => {
          const source = await read(receipt, signal);
          if (source.document !== document)
            throw new Error(
              "The native source capture did not retain the submitted document.",
            );
          this.forgetNativeSource(source.recordId!);
          return source;
        },
        confirmed: read,
      },
      this.scope.signal,
    );
  }
  async updateViewSource(
    input: UpdateTaskViewSourceInput,
    waitForConfirmation = false,
  ): Promise<TaskViewSourceDocument> {
    let target: RecordView | undefined;
    const read = async (_receipt: Receipt, signal: AbortSignal) => {
      if (!target)
        throw new Error("The original native source identity is unavailable.");
      const record = await this.client.views.getSourceRecord(target.id, {
        signal,
      });
      signal.throwIfAborted();
      if (record.id !== target.id)
        throw new Error(
          "The native source READ changed its original record identity.",
        );
      return this.sourceDocument(record, target.path);
    };
    return this.mutations.run(
      {
        key: JSON.stringify(["view:update", input]),
        recordIds: () => (target ? [target.id] : []),
        prepare: async (mutationId, signal) => {
          this.requireViewSourceGrant("records.edit");
          viewSourceRecord(input.path, input.document);
          const id = this.nativeSourceId(input.path);
          if (!id)
            throw nativeUnsupported(
              "Refresh the native view catalog before editing this source.",
            );
          // Genuine current-layer full source, including native tentative CAS.
          const record = await this.client.views.getSourceRecord(id, {
            signal,
          });
          if (
            record.id !== id ||
            record.path !== input.path ||
            record.document === undefined ||
            !Number.isSafeInteger(record.state.confirmedSeq) ||
            record.state.hold ||
            record.state.unresolved
          )
            throw new Error(
              "The native source changed before its complete record READ.",
            );
          if (input.ifRevision && input.ifRevision !== record.revision)
            throw new Error(
              "The view source changed. Reload it before saving.",
            );
          const descriptor = [...this.nativeViews.values()].find(
            (view) => view.record === id,
          );
          if (record.state.state === "confirmed" && descriptor) {
            const source = await this.readNativeSource(descriptor, signal);
            if (
              record.revision !== source.view.sourceRevision ||
              record.document !== source.source
            )
              throw new Error(
                "The native source changed before its complete record READ.",
              );
          }
          signal.throwIfAborted();
          this.requireViewSourceGrant("records.edit");
          target = record;
          return () =>
            this.client.views.updateSource(record, input.document, {
              mutationId,
              signal,
              wait: "pending",
              include: { document: true, body: true },
            });
        },
        ...(waitForConfirmation
          ? {}
          : {
              local: async (receipt: Receipt, signal: AbortSignal) => {
                const source = await read(receipt, signal);
                if (source.document !== input.document)
                  throw new Error(
                    "The native source capture did not retain the submitted document.",
                  );
                this.forgetNativeSource(source.recordId!);
                return source;
              },
            }),
        // A late ACK reads the CURRENT layer, never relabels the earlier
        // receipt's document or overwrites a newer pending source edit.
        confirmed: async (receipt, signal) => {
          const source = await read(receipt, signal);
          if (waitForConfirmation) this.forgetNativeSource(source.recordId!);
          return source;
        },
      },
      this.scope.signal,
    );
  }
  private sourceDocument(
    record: RecordView,
    path: string,
  ): TaskViewSourceDocument {
    if (record.path === path) this.rememberWriteState(record);
    if (
      record.path !== path ||
      record.document === undefined ||
      !Number.isSafeInteger(record.state.confirmedSeq) ||
      record.state.hold ||
      record.state.unresolved
    )
      throw new Error(
        "The native source record is unavailable or has conflicting changes.",
      );
    viewSourceRecord(path, record.document);
    this.sourceRecords.set(path, record.id);
    this.rememberWriteState(record);
    return {
      recordId: record.id,
      path,
      format: "obsidian.base",
      revision: record.revision,
      document: record.document,
    };
  }
  async deleteViewSource(path: string, ifRevision?: string) {
    let target: RecordView | undefined;
    await this.mutations.runRecord(
      {
        recordIds: () => (target ? [target.id] : []),
        key: JSON.stringify(["view:delete", path, ifRevision]),
        prepare: async (mutationId, signal) => {
          this.requireViewSourceGrant("records.delete");
          const id = this.nativeSourceId(path);
          if (!id)
            throw nativeUnsupported(
              "Refresh the native view catalog before deleting this source.",
            );
          const record = await this.client.views.getSourceRecord(id, {
            signal,
          });
          signal.throwIfAborted();
          if (
            record.id !== id ||
            record.path !== path ||
            record.document === undefined ||
            record.state.hold ||
            record.state.unresolved
          )
            throw new Error(
              "The native source changed before its complete record READ.",
            );
          if (ifRevision && ifRevision !== record.revision)
            throw new Error(
              "The view source changed. Reload it before deleting.",
            );
          const descriptor = [...this.nativeViews.values()].find(
            (view) => view.record === id,
          );
          if (record.state.state === "confirmed" && descriptor)
            await this.readNativeSource(descriptor, signal);
          target = record;
          this.requireViewSourceGrant("records.delete");
          return () =>
            this.client.delete(record, {
              ifRevision: record.revision,
              mutationId,
              signal,
              wait: "pending",
            });
        },
        confirmed: async (_receipt, signal) => {
          if (!target)
            throw nativeUnsupported(
              "The original native source identity is unavailable.",
            );
          const record = await this.client.find(target.id, { signal });
          signal.throwIfAborted();
          if (record)
            throw new Error(
              "The original native source is still present after deletion.",
            );
          this.conflictedRecords.delete(target.id);
          this.forgetNativeSource(target.id);
        },
      },
      this.scope.signal,
    );
  }

  async collectionInfo() {
    return {
      kind: "connect" as const,
      id: `next:${this.accountId}:${this.client.collection}`,
      collectionId: this.client.collection,
      name: this.displayName,
      location: this.displayName,
      runtime: Capacitor.isNativePlatform()
        ? ("native" as const)
        : ("browser" as const),
    };
  }
  async connectionStatus(): Promise<RepositoryConnectionStatus> {
    return {
      ...this.status,
      ...(this.sync ? { sync: this.sync } : {}),
      ...(this.client.ledger.getSnapshot().saveState === "saved_on_device"
        ? { savedOnDevice: true }
        : {}),
      ...(this.heldEdits.length ? { heldEdits: this.heldEdits } : {}),
    };
  }
  /** The user's choice for a protected edit: an ordinary change; the list refreshes from the backend's push. */
  async resolveHeldEdit(id: string, how: HeldEditResolution): Promise<void> {
    if (!this.heldEdits.some((edit) => edit.id === id))
      throw new Error("This protected edit is no longer waiting.");
    await this.client.resolveHold(id, how);
    this.invalidateRemoteData();
  }
  subscribe(listener: (change?: RepositoryChange) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  suspend() {
    this.changeWindow.clear();
    this.changesWatch?.();
    this.changesWatch = null;
    this.scope.abort(
      new DOMException("TaskNotes moved to the background.", "AbortError"),
    );
  }
  resume() {
    if (this.disposed)
      throw new Error("The native collection instance has been disposed.");
    if (this.scope.signal.aborted) {
      this.scope = new AbortController();
      this.initialization = null;
      this.indexReady = false;
      this.indexLoading = null;
      this.scratchFeedSnapshot = undefined;
      this.emit("lifecycle");
    }
  }
  dispose() {
    this.changeWindow.clear();
    this.disposed = true;
    this.scope.abort();
    this.changesWatch?.();
    this.changesWatch = null;
    this.stopLink();
    this.stopStatus();
    this.stopLedger();
    this.stopHolds();
    if (this.clientOwnership === "owned") this.client.close();
    this.cache.clear();
    this.conflictedRecords.clear();
    this.sourceRecords.clear();
    this.viewCatalog = [];
    this.viewExecutions.clear();
    this.scratchFeedSnapshot = undefined;
    this.listeners.clear();
  }
  private noteOperationFailure(reason: unknown, signal: AbortSignal): boolean {
    if (
      signal.aborted ||
      this.disposed ||
      !(reason instanceof MdbaseError) ||
      reason.code !== "unavailable"
    )
      return false;
    if (
      this.status.state !== "unavailable" ||
      this.status.message !== reason.message
    ) {
      this.status = {
        ...this.status,
        state: "unavailable",
        message: reason.message,
      };
      this.emit("status");
    }
    return true;
  }
  private reached(dataRead = true) {
    if (
      this.scope.signal.aborted ||
      this.changesWatch?.state !== "active" ||
      (!dataRead && this.status.state === "unavailable")
    )
      return;
    this.status = {
      state: "connected",
      lastReachedAt: new Date().toISOString(),
    };
  }
  private invalidateDataGeneration() {
    this.dataRevision++;
    this.viewExecutions.clear();
    // Every data event, including accepted local writes, invalidates in-flight
    // snapshot promises. New readers must not join an obsolete generation.
    // The old revision guards remain; identity-checked cleanup cannot erase
    // a newer load. Existing remembered task data still needs native reads.
    this.initialization = null;
    this.indexLoading = null;
    this.scratchFeedSnapshot = undefined;
  }
  private emit(kind: RepositoryChange["kind"]) {
    if (kind === "data") this.invalidateDataGeneration();
    if (!this.disposed)
      this.listeners.forEach((listener) => listener({ kind }));
  }
}

/** Settle with `pending`, or reject as soon as this caller's own signal
 * aborts; a shared read keeps running for its other callers. */
function untilAborted<Result>(
  pending: Promise<Result>,
  signal: AbortSignal,
): Promise<Result> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<Result>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    pending.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

function collectionChanged(): MdbaseError {
  return new MdbaseError({
    code: "conflict",
    recovery: "refresh",
    reason: "collection_changed",
    message:
      "The collection changed while data was loading. Refresh to read the current collection.",
  });
}

/**
 * The SDK's hold presentation, projected onto the app port. The app has no merge view,
 * so "compare" is not offered; "keep both" stands in for it. The compare deep link is a
 * desktop (daemon tray / Obsidian) hand-off and needs no collection id here.
 */
export function heldEditFromHold(hold: Hold): HeldEdit {
  const presented = describeHold(hold, {
    collectionId: "00000000-0000-0000-0000-000000000000",
    canCompare: false,
  });
  return {
    id: presented.id,
    path: presented.path,
    title: presented.title,
    cause: presented.cause,
    detail: presented.detail,
    reversibleNote: presented.reversibleNote,
    since: new Date(presented.since).toISOString(),
    saves: presented.saves,
    actions: presented.actions.flatMap((option) =>
      option.resolution
        ? [
            {
              action: option.resolution,
              label: option.label,
              description: option.description,
              discardsMine: option.discardsMine,
            },
          ]
        : [],
    ),
  };
}

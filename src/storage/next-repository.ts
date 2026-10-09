import { Capacitor } from "@capacitor/core";
import {
  MdbaseError,
  toPlain,
  toValue,
  type MdbaseClient,
  type ChangesWatch,
  type PlainValue,
  type UpdateInput as NativeUpdateInput,
  type wire,
  describeHold,
  syncStatusText,
  type Hold,
  type SyncStatus,
} from "@mdbase-dev/sdk";
import { linksTo } from "@mdbase-dev/connect";
import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import { patchTaskNotesMdbaseTypeSettings } from "@tasknotes/model/mdbase";
import type {
  TaskRepository,
  TaskCreateIntent,
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
import type { TaskModelSettingsPatch } from "../domain/task-configuration";
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
import { taskSearchTokens } from "../domain/task-query";
import {
  findOccurrenceParent,
  occurrenceRecordId,
  rollingOccurrenceDates,
} from "../domain/task-occurrence";
import {
  newViewSourcePath,
  taskNotesDefaultBaseSources,
  viewSourceFormat,
  viewSourceRecord,
} from "../domain/default-view-source";
import { normalizePresentationType } from "../domain/view-renderer";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";
import { NextMutations, RejectedNextMutation } from "./next-mutations";
import { NativeModelSetup } from "./next-model-setup";
import { NativeResourceSetup } from "./next-resource-setup";
import {
  TaskNotesModelRequiredError,
  type ModelSetupJournal,
  type ModelResourceSetupJournal,
  type TaskNotesModelSetup,
} from "../application/ports/model-setup";
import { nextTaskProviders, type NextTaskProvider } from "./next-task-catalog";
import { nextTaskDocument, nextTaskSummary } from "./next-task-records";
import { ConnectedTaskIndex } from "./connected-task-index";
import {
  connectedTaskRelationships,
  connectedTaskStats,
} from "./connected-task-cache";
import {
  completeTaskValues,
  completeRecords,
  completionLimit,
} from "./completions";

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
  record: wire.RecordView,
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

function plainFields(fields: wire.FmMap): Record<string, unknown> {
  return Object.fromEntries(
    [...fields].map(([key, value]) => [key, toPlain(value)]),
  );
}

/** Direct native SDK implementation of the application port.
 * Unsupported native metadata is explicit, never reconstructed in the app.
 */
export class NextTaskRepository implements TaskRepository {
  readonly modelSetup?: TaskNotesModelSetup;
  readonly defaultViewSourceCreation = "explicit-only" as const;
  private scope = new AbortController();
  private disposed = false;
  private creatorSetupPending: boolean;
  private providers: NextTaskProvider[] = [];
  private models = new Map<string, TaskNotesTaskModel>();
  private initialization: Promise<void> | null = null;
  private indexLoading: Promise<void> | null = null;
  private indexReady = false;
  private hasLoadedIndex = false;
  private readonly cache = new ConnectedTaskIndex<CachedTask>();
  private readonly mutations: NextMutations;
  private readonly acceptedCreates = new WeakMap<TaskCreateIntent, Task>();
  private readonly listeners = new Set<(change?: RepositoryChange) => void>();
  private readonly stopLink: () => void;
  private status: RepositoryConnectionStatus = { state: "connecting" };
  /** The backend's sync position and protected edits, pushed by the client; merged into `connectionStatus()`. */
  private sync: RepositoryConnectionStatus["sync"];
  private heldEdits: HeldEdit[] = [];
  private readonly stopStatus: () => void;
  private readonly stopHolds: () => void;
  private viewCatalog: TaskViewDocument[] = [];
  private nativeViews = new Map<string, AppBasesDescriptor>();
  private scratchFeedSnapshot?: ScratchFeedPage;
  private dataRevision = 0;
  private changesWatch: ChangesWatch | null = null;

  constructor(
    private readonly client: MdbaseClient,
    private readonly displayName: string,
    private readonly accountId: string,
    options: {
      modelSetupJournal?: ModelSetupJournal;
      /** Actual original-controller completion flag, not resource readiness. */
      requiresTaskNotesModelSetup?: boolean;
      /** Completion recording only after the original client's receipt/readback. */
      onModelSetupVerified?: () => Promise<void>;
    } = {},
  ) {
    this.mutations = new NextMutations(client);
    this.creatorSetupPending = options.requiresTaskNotesModelSetup === true;
    if (
      this.creatorSetupPending &&
      (!options.modelSetupJournal || !options.onModelSetupVerified)
    )
      throw new Error("Original creator completion owner unavailable.");
    if (options.modelSetupJournal) {
      const onVerified = options.onModelSetupVerified;
      const journal = options.modelSetupJournal;
      const verified = async () => {
        this.invalidateRemoteData();
        await onVerified?.();
        this.signal().throwIfAborted();
        this.creatorSetupPending = false;
      };
      const legacy = (signal?: AbortSignal) =>
        new NativeModelSetup(
          client,
          journal,
          () => signal ?? this.signal(),
          verified,
        );
      // The real protected store implements both ports. Legacy-only adapters
      // retain their original seam; no v1/v2 intent is enlarged into v3.
      const resourceJournal = journal as Partial<ModelResourceSetupJournal>;
      const supportsResources =
        typeof resourceJournal.prepareResources === "function" &&
        typeof resourceJournal.recordResourceAttempt === "function" &&
        typeof resourceJournal.recordResourceConfirmed === "function" &&
        typeof resourceJournal.recordResourceVerified === "function";
      const setup = supportsResources
        ? new NativeResourceSetup(
            client,
            journal as ModelResourceSetupJournal,
            () => this.signal(),
            taskNotesDefaultBaseSources,
            verified,
            legacy,
          )
        : legacy();
      this.modelSetup = Object.freeze({
        inspect: () => setup.inspect(),
        install: () => setup.install(),
        resume: () => setup.resume(),
      });
    }
    this.stopStatus = client.onStatus((status: SyncStatus) => {
      if (this.disposed) return;
      this.sync = {
        text: syncStatusText(status),
        pending: status.pending,
        held: status.holds,
      };
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
    if (revision !== this.dataRevision)
      throw new MdbaseError({
        code: "conflict",
        recovery: "refresh",
        reason: "collection_changed",
        message:
          "The collection changed while data was loading. Refresh to read the current collection.",
      });
  }

  private invalidateRemoteData() {
    this.initialization = null;
    this.indexReady = false;
    this.viewCatalog = [];
    this.nativeViews.clear();
    this.emit("data");
  }

  private async observeChanges(signal: AbortSignal): Promise<void> {
    if (!this.changesWatch) {
      const scope = this.scope;
      const current = () =>
        !this.disposed &&
        !scope.signal.aborted &&
        scope === this.scope &&
        this.changesWatch === watch;
      const watch = this.client.watchChanges(undefined, () => {
        if (current()) this.invalidateRemoteData();
      });
      this.changesWatch = watch;
      watch.subscribe((state, error) => {
        if (!current()) return;
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
    signal.throwIfAborted();
    if (this.creatorSetupPending)
      throw new TaskNotesModelRequiredError(
        "Complete this original collection's TaskNotes setup before opening tasks and views.",
      );
    await this.observeChanges(signal);
    if (!this.initialization) {
      const revision = this.dataRevision;
      const loading = (async () => {
        const providers = await nextTaskProviders(this.client, signal);
        signal.throwIfAborted();
        this.assertCurrentData(revision);
        this.providers = providers;
        this.models = new Map(providers.map((p) => [p.typeName, p.model]));
        this.reached(false);
      })().catch((reason) => {
        if (this.initialization === loading) this.initialization = null;
        this.noteOperationFailure(reason, signal);
        throw reason;
      });
      this.initialization = loading;
    }
    await this.initialization;
    signal.throwIfAborted();
    if (!options.deferTaskIndex) await this.ensureIndex();
  }

  private async ensureIndex(): Promise<void> {
    const signal = this.signal();
    await this.initialize({ deferTaskIndex: true });
    signal.throwIfAborted();
    if (this.indexReady) return;
    if (this.indexLoading) return this.indexLoading;
    const writes = this.cache.trackWrites();
    const revision = this.dataRevision;
    const loading = (async () => {
      const snapshot = new Map<string, CachedTask>();
      for await (const page of this.client.pages(
        { types: [...this.models.keys()], limit: 1000 },
        { effective: true },
        signal,
      )) {
        signal.throwIfAborted();
        if (!page.complete)
          throw nativeUnsupported(
            "The replica has not supplied a complete task index.",
          );
        for (const record of page.records) {
          const decoded = this.decodeSummary(record);
          if (decoded) {
            const previous = snapshot.get(decoded.task.id);
            if (previous && previous.recordId !== decoded.recordId)
              throw new Error(
                "Two native records have the same portable TaskNotes identity. Resolve the duplicate before opening this collection.",
              );
            snapshot.set(decoded.task.id, decoded);
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
        if (!writes.paths.has(value.task.path)) this.cache.set(id, value);
      this.indexReady = true;
      this.hasLoadedIndex = true;
      this.reached();
    })().finally(() => {
      writes.stop();
      if (this.indexLoading === loading) this.indexLoading = null;
    });
    this.indexLoading = loading;
    return loading;
  }

  private decodeSummary(record: wire.RecordView): CachedTask | null {
    const task = nextTaskSummary(record, this.models);
    if (!task) return null;
    const typeName = record.types.find((name) => this.models.has(name))!;
    return {
      task,
      recordId: record.id,
      typeName,
      model: this.models.get(typeName)!,
    };
  }

  private remember(record: wire.RecordView): Task {
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
    const record = await this.client.get(
      entry.recordId,
      { body: true, effective: true },
      signal,
    );
    signal.throwIfAborted();
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

  private scratchpad(record: wire.RecordView): ScratchpadDocument {
    if (record.body === undefined)
      throw new Error("Mdbase did not return the complete scratchpad body.");
    return scratchpadFromRecord({
      path: record.path,
      revision: record.revision,
      types: record.types,
      frontmatter: plainFields(record.frontmatter),
      body: record.body,
    });
  }

  private async scratchpadRecords(
    signal: AbortSignal,
  ): Promise<wire.RecordView[]> {
    const records: wire.RecordView[] = [];
    const identities = new Set<string>();
    // Query every note: an incomplete narrowed answer must never create a note.
    for await (const page of this.client.pages(
      { types: [SCRATCHPAD_TYPE], limit: 1000 },
      { body: true },
      signal,
    )) {
      signal.throwIfAborted();
      if (!page.complete)
        throw nativeUnsupported(
          "The replica has not supplied a complete scratchpad stream.",
        );
      for (const record of page.records) {
        const note = this.scratchpad(record);
        if (identities.has(note.id))
          throw new Error(
            "Two native notes have the same portable Scratchpad identity. Resolve the duplicate before opening this stream.",
          );
        identities.add(note.id);
        records.push(record);
      }
    }
    signal.throwIfAborted();
    return records;
  }

  private findScratchpad(
    records: wire.RecordView[],
    reference: { id: string; path?: string },
  ): wire.RecordView {
    const record = records.find(
      (record) => this.scratchpad(record).id === reference.id,
    );
    if (!record) throw new Error("The scratchpad is no longer available.");
    const note = this.scratchpad(record);
    if (reference.path && note.path !== reference.path)
      throw new Error("This scratchpad changed. Reload it before saving.");
    return record;
  }

  private currentScratchpad(records: wire.RecordView[]): wire.RecordView {
    const notes = records.map((record) => ({
      path: record.path,
      revision: record.revision,
      types: record.types,
      frontmatter: plainFields(record.frontmatter),
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
    const note = this.scratchpad(
      await this.client.get(nativeId, { body: true }, signal),
    );
    signal.throwIfAborted();
    if (note.id !== portableId)
      throw new Error(
        "The saved scratchpad's portable identity changed. Reload before continuing.",
      );
    return note;
  }

  getActiveScratchpad(): Promise<ScratchpadDocument> {
    const signal = this.signal();
    let target: { nativeId: string; portableId: string };
    return this.mutations.run(
      {
        key: JSON.stringify(["scratchpad:active"]),
        prepare: async (mutationId, requestSignal) => {
          const records = await this.scratchpadRecords(requestSignal);
          if (
            !records.some(
              (record) => this.scratchpad(record).state === "active",
            )
          ) {
            const values = newScratchpadValues();
            target = {
              nativeId: crypto.randomUUID(),
              portableId: values.frontmatter.id as string,
            };
            return () =>
              this.client.create(
                {
                  id: target.nativeId,
                  type: SCRATCHPAD_TYPE,
                  ...values,
                  frontmatter: values.frontmatter as Record<string, PlainValue>,
                },
                { mutationId, signal: requestSignal },
              );
          }
          const current = this.currentScratchpad(records);
          const duplicates = records.filter(
            (record) =>
              record.id !== current.id &&
              this.scratchpad(record).state === "active",
          );
          if (!duplicates.length) return { value: this.scratchpad(current) };
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
            (
              await this.client.submit(ops, {
                mutationId,
                signal: requestSignal,
              })
            )[0]!;
        },
        confirmed: async (_, requestSignal) => {
          const current = await this.savedScratchpad(
            target.nativeId,
            target.portableId,
            requestSignal,
          );
          this.reached();
          this.emit("data");
          return current;
        },
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
    const signal = this.signal();
    const captured = structuredClone(input);
    let nativeId: string;
    return this.mutations.run(
      {
        key: JSON.stringify(["scratchpad:save", captured]),
        prepare: async (mutationId, requestSignal) => {
          const record = this.findScratchpad(
            await this.scratchpadRecords(requestSignal),
            captured,
          );
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
            (
              await this.client.submit([op], {
                mutationId,
                signal: requestSignal,
              })
            )[0]!;
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

  startNewScratchpad(input: StartNewScratchpadInput) {
    const signal = this.signal();
    const captured = structuredClone(input);
    let previousId: string;
    let next: { nativeId: string; portableId: string };
    return this.mutations.run(
      {
        key: JSON.stringify(["scratchpad:new", captured]),
        prepare: async (mutationId, requestSignal) => {
          const records = await this.scratchpadRecords(requestSignal);
          const record = this.currentScratchpad(records);
          const current = this.scratchpad(record);
          assertScratchpadRevision(current, captured);
          const now = new Date().toISOString();
          const values = newScratchpadValues(now);
          previousId = record.id;
          next = {
            nativeId: crypto.randomUUID(),
            portableId: values.frontmatter.id as string,
          };
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
            (
              await this.client.submit(ops, {
                mutationId,
                signal: requestSignal,
              })
            )[0]!;
        },
        confirmed: async (_, requestSignal) => {
          const previous = await this.savedScratchpad(
            previousId,
            captured.id,
            requestSignal,
          );
          const current = await this.savedScratchpad(
            next.nativeId,
            next.portableId,
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

  reactivateScratchpad(input: ReactivateScratchpadInput) {
    const signal = this.signal();
    const captured = structuredClone(input);
    let previousId: string;
    let currentId: string;
    return this.mutations.run(
      {
        key: JSON.stringify(["scratchpad:reactivate", captured]),
        prepare: async (mutationId, requestSignal) => {
          if (captured.current.id === captured.target.id)
            throw new Error("The current scratchpad cannot resume itself.");
          const records = await this.scratchpadRecords(requestSignal);
          const previous = this.currentScratchpad(records);
          const current = this.findScratchpad(records, captured.target);
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
            (
              await this.client.submit(ops, {
                mutationId,
                signal: requestSignal,
              })
            )[0]!;
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
    return this.mutations.run(
      {
        key: JSON.stringify(["scratchpad:delete", captured]),
        prepare: async (mutationId, requestSignal) => {
          const record = this.findScratchpad(
            await this.scratchpadRecords(requestSignal),
            captured,
          );
          const note = this.scratchpad(record);
          assertScratchpadRevision(note, captured);
          if (note.state !== "converted")
            throw new Error("Only a previous note can be deleted.");
          const op: wire.Op = {
            kind: "delete",
            id: record.id,
            ifRevision: record.revision,
          };
          return async () =>
            (
              await this.client.submit([op], {
                mutationId,
                signal: requestSignal,
              })
            )[0]!;
        },
        confirmed: async (_, requestSignal) => {
          requestSignal.throwIfAborted();
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

  private scratchImage(record: wire.RecordView): ScratchImage {
    return scratchImageFromRecord({
      path: record.path,
      revision: record.revision,
      types: record.types,
      frontmatter: plainFields(record.frontmatter),
    });
  }

  private async scratchImageRecords(
    signal: AbortSignal,
  ): Promise<wire.RecordView[]> {
    const records: wire.RecordView[] = [];
    const identities = new Set<string>();
    for await (const page of this.client.pages(
      { types: [SCRATCH_IMAGE_TYPE], limit: 1000 },
      undefined,
      signal,
    )) {
      signal.throwIfAborted();
      if (!page.complete)
        throw nativeUnsupported(
          "The replica has not supplied complete Scratchpad image metadata.",
        );
      for (const record of page.records) {
        const image = this.scratchImage(record);
        if (identities.has(image.id))
          throw new Error(
            "Two native images have the same portable Scratchpad identity. Resolve the duplicate before opening this stream.",
          );
        identities.add(image.id);
        records.push(record);
      }
    }
    signal.throwIfAborted();
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
    return this.mutations.run(
      {
        key: JSON.stringify(["scratch-image:create", captured]),
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
          const image = this.scratchImage(
            await this.client.get(nativeId, undefined, requestSignal),
          );
          requestSignal.throwIfAborted();
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
    return this.mutations.run(
      {
        key: JSON.stringify(["scratch-image:remove", captured]),
        prepare: async (mutationId, requestSignal) => {
          const records = await this.scratchImageRecords(requestSignal);
          const record = records.find(
            (record) =>
              this.scratchImage(record).id === captured.id &&
              record.path === captured.path,
          );
          if (!record)
            throw new Error("The image feed record is no longer available.");
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
          requestSignal.throwIfAborted();
          this.reached();
          this.emit("data");
        },
      },
      signal,
    );
  }

  private async assignedPaths(
    personPath?: string,
    signal: AbortSignal = this.signal(),
  ): Promise<Set<string> | undefined> {
    if (personPath === undefined) return undefined;
    const paths = new Set<string>();
    for (const provider of this.providers) {
      for await (const page of this.client.pages(
        {
          types: [provider.typeName],
          where: linksTo(
            provider.model.config.fieldMapping.assignees,
            personPath,
            { multiple: true },
          ),
          limit: 1000,
        },
        undefined,
        signal,
      )) {
        signal.throwIfAborted();
        if (!page.complete)
          throw nativeUnsupported(
            "The replica has not supplied complete assignment matches.",
          );
        page.records.forEach((record) => paths.add(record.path));
      }
    }
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
          undefined,
          signal,
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
    const record = await this.client.find(
      entry.recordId,
      { effective: true },
      signal,
    );
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
        order_by: ["file.path"],
      },
      { effective: true },
      signal,
    );
    signal.throwIfAborted();
    const records: CollectionRecord[] = result.records.map((r) => ({
      path: r.path,
      label: String(plainFields(r.effective ?? r.frontmatter).title ?? r.path),
      frontmatter: plainFields(r.effective ?? r.frontmatter),
      types: r.types,
    }));
    return completeRecords(
      records,
      request,
      this.providers[0]!.model.config.linkWriteFormat,
    ).map((completion) => {
      const task = completion.path
        ? this.cache.atPath(completion.path)?.task
        : undefined;
      return task ? { ...completion, taskId: task.id } : completion;
    });
  }

  async create(
    input: CreateTaskInput,
    intent: TaskCreateIntent = { id: crypto.randomUUID() },
  ): Promise<Task> {
    const owner = this.scope.signal;
    owner.throwIfAborted();
    const accepted = this.acceptedCreates.get(intent);
    if (accepted) return accepted;
    await this.initialize({ deferTaskIndex: true });
    owner.throwIfAborted();
    let rollingWarnings: string[] = [];
    const task = await this.mutations
      .run(
        {
          key: JSON.stringify(["task:create", intent.id]),
          requestId: intent.authorityRequestId,
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
                  { mutationId, signal },
                );
              return (
                await this.client.submit(
                  [
                    createRecordOp(intent.id, provider.typeName, task),
                    ...rolling.ops,
                  ],
                  { mutationId, signal },
                )
              )[0]!;
            };
          },
          confirmed: async (_receipt, signal) => {
            const record = await this.client.get(
              intent.id,
              { body: true, effective: true },
              signal,
            );
            signal.throwIfAborted();
            const saved = this.remember(record);
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
    delete intent.authorityRequestId;
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
      const occupied = await this.client.find({ path }, undefined, signal);
      signal.throwIfAborted();
      if (!occupied) return path === task.path ? task : { ...task, path };
    }
    throw new Error(
      "task_path_collision: Could not allocate a unique task path.",
    );
  }

  private async template(path: string, signal: AbortSignal): Promise<string> {
    const record = await this.client.get({ path }, { document: true }, signal);
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
    return this.mutations.run(
      {
        key,
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
                { mutationId, signal },
              );
          const ops = [
            this.client.updateOp(
              current.record,
              taskChanges(current.record, current.task, next),
            ),
            ...rolling.ops,
          ];
          return async () =>
            (await this.client.submit(ops, { mutationId, signal }))[0]!;
        },
        confirmed: async (_receipt, signal) => {
          if (!recordId)
            throw new Error(
              "The confirmed task identity cannot be resolved. Refresh before continuing.",
            );
          const record = await this.client.get(
            recordId,
            { body: true, effective: true },
            signal,
          );
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

  update(id: string, input: UpdateTaskInput) {
    return this.mutateTask(
      id,
      JSON.stringify(["task:update", id, input]),
      (task, model) =>
        model.update(task, input, { now: new Date().toISOString() }),
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
    return this.mutations.run(
      {
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
            (await this.client.submit(ops, { mutationId, signal }))[0]!;
        },
        confirmed: async (_receipt, signal) => {
          const records = await Promise.all(
            targets.map((recordId) =>
              this.client.get(
                recordId,
                { body: true, effective: true },
                signal,
              ),
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
  ): Promise<MaterializeOccurrenceResult> {
    const owner = this.scope.signal;
    owner.throwIfAborted();
    const recordId = await occurrenceRecordId(parentId, occurrenceDate);
    owner.throwIfAborted();
    let warnings: string[] = [];
    return this.mutations.run<MaterializeOccurrenceResult>(
      {
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
            { id: recordId, now: new Date().toISOString() },
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
              { mutationId, signal },
            );
        },
        confirmed: async (_r, signal) => {
          const record = await this.client.get(
            recordId,
            { body: true, effective: true },
            signal,
          );
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
    return this.mutations.run(
      {
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
            (await this.client.submit(ops, { mutationId, signal }))[0]!;
        },
        confirmed: async (_r, signal) => {
          if (!recordId)
            throw new Error(
              "The archived native record identity was not retained.",
            );
          const record = await this.client.get(
            recordId,
            { body: true, effective: true },
            signal,
          );
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
    options: { authorityRequestId?: string } = {},
  ): Promise<void> {
    const owner = this.scope.signal;
    owner.throwIfAborted();
    await this.ensureIndex();
    owner.throwIfAborted();
    if (!this.cache.has(id) && !options.authorityRequestId) return;
    await this.mutations.run(
      {
        key: JSON.stringify(["task:delete", id]),
        requestId: options.authorityRequestId,
        prepare: async (mutationId, signal) => {
          const current = await this.current(id, signal);
          return () =>
            this.client.delete(current.record, {
              ifRevision: current.record.revision,
              mutationId,
              signal,
            });
        },
        confirmed: async () => {
          this.cache.delete(id);
          this.emit("data");
        },
      },
      this.scope.signal,
    );
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
    return this.providers[0]!.model.configuration();
  }
  async taskModelSettingsAccess() {
    const signal = this.signal();
    await this.initialize({ deferTaskIndex: true });
    signal.throwIfAborted();
    const source = this.providers[0]!.sourcePath;
    if (!this.client.hello.grant.capabilities.includes("definitions.manage"))
      return {
        writable: false as const,
        source,
        reason: "Task model settings need definition management access.",
      };
    try {
      await this.client.resources.get(source, signal);
      signal.throwIfAborted();
      return { writable: true as const, source };
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
    const source = this.providers[0]!.sourcePath;
    await this.mutations.run(
      {
        key: JSON.stringify(["task:settings", patch]),
        prepare: async (mutationId, signal) => {
          const resource = await this.client.resources.get(source, signal);
          if (resource.text === undefined)
            throw new Error("The replica did not supply the task type source.");
          const parsed = parseFrontmatter(resource.text);
          const text = serializeMarkdownDocument(
            patchTaskNotesMdbaseTypeSettings(parsed.frontmatter, patch),
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
          const providers = await nextTaskProviders(this.client, signal);
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
    const signal = this.signal();
    await this.initialize({ deferTaskIndex: true });
    const revision = this.dataRevision;
    const descriptors = new Map<string, AppBasesDescriptor>();
    const documents = new Map<string, TaskViewDocument>();
    const timezone = runtimeTimezone();
    for await (const views of iterateNativeDiscovery(async (continuation) => {
      const result = await this.client.listAppBasesViews(
        { captureTimezone: timezone, limit: 128, continuation },
        signal,
      );
      if (result.kind === "refusal") throw new MdbaseError(result.problem);
      return result;
    }, signal)) {
      this.assertCurrentData(revision);
      for (const descriptor of views) {
        const key = taskViewKey(descriptor.record, String(descriptor.ordinal));
        descriptors.set(key, structuredClone(descriptor));
        let document = documents.get(descriptor.record);
        if (!document) {
          document = {
            id: descriptor.record,
            name: descriptor.path,
            source: {
              path: descriptor.path,
              revision: descriptor.sourceRevision,
              format: "obsidian.base",
              writable: false,
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
    return structuredClone(this.viewCatalog);
  }
  async cachedViewExecution() {
    return null;
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
      signal,
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
  private requireViewSourceGrant(
    capability: "records.edit" | "records.delete",
  ) {
    const grant = this.client.hello.grant;
    if (
      grant.role === "viewer" ||
      !grant.capabilities.includes("collection.read") ||
      !grant.capabilities.includes(capability) ||
      grant.fileFolders !== undefined
    )
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
  ): Promise<TaskViewExecution> {
    await this.initialize({ deferTaskIndex: true });
    signal.throwIfAborted();
    // A data push can invalidate discovery before the selected view reloads.
    // Rediscover through the original client, then enforce the same exact
    // source identity; never execute a retained descriptor as a stale fallback.
    if (!this.nativeViews.has(view.key)) await this.listViews();
    signal.throwIfAborted();
    const revision = this.dataRevision;
    const descriptor = this.nativeView(view);
    const timezone = runtimeTimezone();
    const selected = await this.readNativeSource(descriptor, signal, timezone);
    this.assertCurrentData(revision);
    const result = await this.client.executeAppBases(
      {
        ...nativeViewSelection(descriptor),
        hints: new Map(),
        captureTimezone: timezone,
        ...(window === undefined ? {} : { window }),
      },
      signal,
    );
    if (result.kind === "refusal") throw new MdbaseError(result.problem);
    if (
      result.view.record !== descriptor.record ||
      result.view.sourceRevision !== descriptor.sourceRevision ||
      result.view.ordinal !== descriptor.ordinal ||
      result.view.path !== descriptor.path
    )
      throw new Error("Native execution changed its selected source identity.");
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
      (id, current) => this.client.get(id, { effective: true }, current),
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
          effectiveFrontmatter: Object.fromEntries(
            [...(record.effective ?? record.frontmatter)].map(
              ([key, value]) => [key, toPlain(value)],
            ),
          ),
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
    return normalized;
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
    viewSourceRecord(path, input.document);
    // A resource reply supplies no record UUID. Do not submit a creation whose
    // result cannot yet be identified and read through this held data port.
    throw nativeUnsupported(
      "Creating view sources is not available through this native session.",
    );
  }
  async updateViewSource(
    input: UpdateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument> {
    let target: AppBasesDescriptor | undefined;
    return this.mutations.run(
      {
        key: JSON.stringify(["view:update", input]),
        prepare: async (mutationId, signal) => {
          this.requireViewSourceGrant("records.edit");
          const source = await this.readNativeSource(
            this.nativeSourceDescriptor(input.path),
            signal,
          );
          if (
            input.ifRevision &&
            input.ifRevision !== source.view.sourceRevision
          )
            throw new Error(
              "The view source changed. Reload it before saving.",
            );
          // Whole-document replacement needs the actual public RecordView,
          // not an object reconstructed from a source descriptor or path.
          const record = await this.client.get(
            source.view.record,
            { document: true },
            signal,
          );
          if (
            record.id !== source.view.record ||
            record.path !== source.view.path ||
            record.revision !== source.view.sourceRevision ||
            record.state.state !== "confirmed" ||
            record.document !== source.source
          )
            throw new Error(
              "The native source changed before its complete record READ.",
            );
          signal.throwIfAborted();
          this.requireViewSourceGrant("records.edit");
          target = structuredClone(source.view);
          return () =>
            this.client.replaceDocument(record, input.document, {
              ifRevision: source.view.sourceRevision,
              mutationId,
              signal,
            });
        },
        confirmed: async (receipt, signal) => {
          if (!target)
            throw nativeUnsupported(
              "The original native source identity is unavailable.",
            );
          const record = await this.client.get(
            target.record,
            { document: true },
            signal,
          );
          const admitted = receipt.records?.find(
            (item) => item.id === target!.record,
          );
          if (
            record.id !== target.record ||
            record.path !== target.path ||
            record.state.state !== "confirmed" ||
            record.document === undefined ||
            record.document !== input.document ||
            (receipt.records !== undefined &&
              (!admitted ||
                admitted.path !== target.path ||
                admitted.revision !== record.revision))
          )
            throw new Error(
              "The confirmed native view source could not be read with its exact identity and document.",
            );
          this.forgetNativeSource(target.record);
          return {
            recordId: record.id,
            path: record.path,
            format: "obsidian.base",
            revision: record.revision,
            document: record.document,
          };
        },
      },
      this.scope.signal,
    );
  }
  async deleteViewSource(path: string, ifRevision?: string) {
    let target: AppBasesDescriptor | undefined;
    await this.mutations.run(
      {
        key: JSON.stringify(["view:delete", path, ifRevision]),
        prepare: async (mutationId, signal) => {
          this.requireViewSourceGrant("records.delete");
          const source = await this.readNativeSource(
            this.nativeSourceDescriptor(path),
            signal,
          );
          if (ifRevision && ifRevision !== source.view.sourceRevision)
            throw new Error(
              "The view source changed. Reload it before deleting.",
            );
          target = structuredClone(source.view);
          return () =>
            this.client.delete(source.view.record, {
              ifRevision: source.view.sourceRevision,
              mutationId,
              signal,
            });
        },
        confirmed: async () => {
          if (!target)
            throw nativeUnsupported(
              "The original native source identity is unavailable.",
            );
          this.forgetNativeSource(target.record);
        },
      },
      this.scope.signal,
    );
  }

  async collectionInfo() {
    return {
      kind: "connect" as const,
      id: `next:${this.accountId}:${this.client.collection}`,
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
    this.disposed = true;
    this.scope.abort();
    this.changesWatch?.();
    this.changesWatch = null;
    this.stopLink();
    this.stopStatus();
    this.stopHolds();
    this.client.close();
    this.cache.clear();
    this.viewCatalog = [];
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
  private emit(kind: RepositoryChange["kind"]) {
    if (kind === "data") {
      this.dataRevision++;
      // Every data event, including accepted local writes, invalidates in-flight
      // snapshot promises. New readers must not join an obsolete generation.
      // The old revision guards remain; identity-checked cleanup cannot erase
      // a newer load. Existing remembered task data still needs native reads.
      this.initialization = null;
      this.indexLoading = null;
      this.scratchFeedSnapshot = undefined;
    }
    if (!this.disposed)
      this.listeners.forEach((listener) => listener({ kind }));
  }
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

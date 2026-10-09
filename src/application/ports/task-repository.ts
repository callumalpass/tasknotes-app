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
} from "../../domain/task";
import type {
  TaskCollectionConfiguration,
  TaskModelSettingsAccess,
  TaskModelSettingsPatch,
} from "../../domain/task-configuration";
import type { TaskRelationships } from "../../domain/task-relationships";
import type {
  ArchiveScratchpadInput,
  ReactivateScratchpadInput,
  ReactivateScratchpadResult,
  SaveScratchpadInput,
  ScratchpadArchiveResult,
  ScratchpadDocument,
  ScratchpadPage,
  ScratchpadPageRequest,
  ScratchpadReference,
  StartNewScratchpadInput,
  StartNewScratchpadResult,
} from "../../domain/scratchpad";
import type {
  ScratchFeedPage,
  ScratchFeedPageRequest,
} from "../../domain/scratch-feed";
import type {
  CreateScratchImageInput,
  ScratchImage,
} from "../../domain/scratch-image";
import type {
  FieldCompletion,
  FieldCompletionRequest,
} from "../../domain/completion";
import type {
  CreateTaskViewSourceInput,
  TaskView,
  TaskViewDocument,
  TaskViewExecution,
  TaskViewSourceDocument,
  UpdateTaskViewSourceInput,
} from "../../domain/view";
import type { CollectionFileStore } from "./collection-file-store";

/** Retain this object for one submission, including uncertain-outcome retries. */
export interface TaskCreateIntent {
  readonly id: string;
  /** The adapter pins only this intent's uncertain request; recovery never replays it. */
  authorityRequestId?: string;
}

/**
 * Application-facing collection boundary. Storage and provider adapters
 * implement this port; React and domain services never depend on an adapter.
 */
export interface TaskRepository {
  /** Present for connected collections whose authority implements mdbase files. */
  readonly files?: CollectionFileStore;
  /** Account/person discovery is unavailable in non-account demo repositories. */
  people?(
    signal?: AbortSignal,
  ): Promise<import("../../domain/people").PeopleDirectory>;
  /**
   * The person record path each saved assignee link of a task resolves to,
   * keyed by link value; null for links that do not resolve. Resolution is
   * the collection's, never reimplemented by the app.
   */
  resolveAssignees?(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<Map<string, string | null>>;
  /** Workspace mode opens configuration without waiting for collection-wide indexes. */
  initialize(options?: { deferTaskIndex?: boolean }): Promise<void>;
  refresh(): Promise<RefreshResult>;
  /** Reconcile durable timer membership using this repository's authority and lifecycle. */
  reconcileReminders?(): Promise<void>;
  /** Lightweight metadata; no body is fetched or represented as empty. */
  listSummaries(query?: Omit<TaskListQuery, "search">): Promise<TaskSummary[]>;
  /** Metadata plus observed match evidence; never downloads bodies. */
  search(
    query: TaskListQuery,
    options?: { signal?: AbortSignal },
  ): Promise<TaskSearchResult[]>;
  /** Complete documents for callers explicitly requiring bodies. */
  list(
    query?: TaskListQuery,
    options?: { signal?: AbortSignal },
  ): Promise<Task[]>;
  /** Resolve metadata without waiting for a document body or revision read. */
  getSummary(id: string): Promise<TaskSummary | null>;
  get(id: string): Promise<Task | null>;
  relationships(id: string): Promise<TaskRelationships>;
  completeField(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
  create(input: CreateTaskInput, intent?: TaskCreateIntent): Promise<Task>;
  update(id: string, input: UpdateTaskInput): Promise<Task>;
  updateMany(
    updates: readonly { id: string; input: UpdateTaskInput }[],
  ): Promise<Task[]>;
  /** With completed supplied, converge to that state rather than blindly toggling. */
  toggle(
    id: string,
    occurrenceDate?: string,
    completed?: boolean,
  ): Promise<Task>;
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
  delete(id: string, options?: { authorityRequestId?: string }): Promise<void>;
  stats(): Promise<TaskStats>;
  /** Intent policy only, never evidence of READ readiness or write authority.
   * Explicit-only repositories must not seed view sources during navigation.
   * Absence preserves the existing automatic-default behavior.
   */
  readonly defaultViewSourceCreation?: "explicit-only";
  cachedViews(): Promise<TaskViewDocument[]>;
  listViews(): Promise<TaskViewDocument[]>;
  cachedViewExecution(view: TaskView): Promise<TaskViewExecution | null>;
  executeView(view: TaskView): Promise<TaskViewExecution>;
  /** Caller-driven pages in authority order, with whole-query counts/groups.
   * cumulative returns immutable visible-prefix snapshots, accumulated once by the adapter.
   * Closing/aborting the iterator must release its read cursor. No UI provider branching.
   */
  iterateView?(
    view: TaskView,
    options?: { signal?: AbortSignal; cumulative?: boolean },
  ): AsyncIterable<TaskViewExecution>;
  readViewSource(path: string): Promise<TaskViewSourceDocument>;
  createViewSource(
    input: CreateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument>;
  updateViewSource(
    input: UpdateTaskViewSourceInput,
  ): Promise<TaskViewSourceDocument>;
  deleteViewSource(path: string, ifRevision?: string): Promise<void>;
  /** Mixed Scratchpad history; the sole current note is returned separately. */
  listScratchFeed?(request?: ScratchFeedPageRequest): Promise<ScratchFeedPage>;
  createScratchImage?(input: CreateScratchImageInput): Promise<ScratchImage>;
  getScratchImage?(id: string, path?: string): Promise<ScratchImage | null>;
  /** Removes metadata membership only. Binary bytes are deliberately retained. */
  removeScratchImage?(
    image: Pick<ScratchImage, "id" | "path" | "revision">,
  ): Promise<void>;
  /** @deprecated Compatibility projection used by older clients. */
  listScratchpads?(request?: ScratchpadPageRequest): Promise<ScratchpadPage>;
  getScratchpad?(id: string): Promise<ScratchpadDocument | null>;
  getActiveScratchpad?(): Promise<ScratchpadDocument>;
  saveScratchpad?(input: SaveScratchpadInput): Promise<ScratchpadDocument>;
  startNewScratchpad?(
    input: StartNewScratchpadInput,
  ): Promise<StartNewScratchpadResult>;
  reactivateScratchpad?(
    input: ReactivateScratchpadInput,
  ): Promise<ReactivateScratchpadResult>;
  /**
   * Permanently deletes a previous note's record. The current note is never
   * deletable; callers own any undo window before invoking this.
   */
  deleteScratchpad?(input: ScratchpadReference): Promise<void>;
  /** @deprecated Compatibility alias for startNewScratchpad. */
  archiveScratchpad?(
    input: ArchiveScratchpadInput,
  ): Promise<ScratchpadArchiveResult>;
  taskConfiguration(): Promise<TaskCollectionConfiguration>;
  taskModelSettingsAccess(): Promise<TaskModelSettingsAccess>;
  updateTaskModelSettings(
    patch: TaskModelSettingsPatch,
  ): Promise<TaskCollectionConfiguration>;
  collectionInfo(): Promise<CollectionInfo>;
  connectionStatus(): Promise<RepositoryConnectionStatus>;
  /** Submit a protected-edit choice. Returning is not a log-confirmed save. */
  resolveHeldEdit?(id: string, how: HeldEditResolution): Promise<void>;
  subscribe(listener: (change?: RepositoryChange) => void): () => void;
  /** Cancel active foreground authority work without discarding local UI state. */
  suspend?(): void;
  /** Open a fresh foreground cancellation scope after suspension. */
  resume?(): void;
  /** Permanently cancel this collection instance when selection changes. */
  dispose?(): void;
}

export interface CollectionInfo {
  kind: "connect";
  id?: string;
  name: string;
  location: string;
  runtime: "browser" | "native";
}

/** Legacy producers may omit the event; omission means data may have changed. */
export interface RepositoryChange {
  /** lifecycle means foreground cursors were interrupted and must be reopened;
   * it does not imply collection data or availability changed. */
  kind: "data" | "status" | "lifecycle";
}

export interface RepositoryConnectionStatus {
  state: "connecting" | "connected" | "unavailable";
  lastReachedAt?: string;
  message?: string;
  sync?: { text: string; pending: number; held: number };
  heldEdits?: HeldEdit[];
}

/** The backend's resolve_hold vocabulary, not a second resolution protocol. */
export type HeldEditResolution =
  "keep_mine" | "take_theirs" | "keep_both" | "delete" | "use";
export interface HeldEditAction {
  action: HeldEditResolution;
  label: string;
  description: string;
  discardsMine: boolean;
}
export interface HeldEdit {
  id: string;
  path: string;
  title: string;
  cause: string;
  detail: string;
  reversibleNote: string;
  since: string;
  saves: number;
  actions: HeldEditAction[];
  /** Read-only, bounded text previews; never submitted as a merged document. */
  comparison?: { mine: string; theirs: string; shortened: boolean };
  comparisonUnavailable?: string;
}

export interface RefreshResult {
  /** Records examined in this refresh, not the collection's total size. */
  scanned: number;
  changed: number;
  removed: number;
  elapsedMs: number;
}

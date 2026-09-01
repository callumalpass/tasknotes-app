import type {
  CreateTaskInput,
  MaterializeOccurrenceResult,
  Task,
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

/**
 * Application-facing collection boundary. Storage and provider adapters
 * implement this port; React and domain services never depend on an adapter.
 */
export interface TaskRepository {
  /** Present for connected collections whose authority implements mdbase files. */
  readonly files?: CollectionFileStore;
  initialize(): Promise<void>;
  refresh(): Promise<RefreshResult>;
  list(query?: TaskListQuery): Promise<Task[]>;
  get(id: string): Promise<Task | null>;
  relationships(id: string): Promise<TaskRelationships>;
  completeField(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
  create(input: CreateTaskInput): Promise<Task>;
  update(id: string, input: UpdateTaskInput): Promise<Task>;
  updateMany(
    updates: readonly { id: string; input: UpdateTaskInput }[],
  ): Promise<Task[]>;
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
  delete(id: string, options?: { authorityRequestId?: string }): Promise<void>;
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
  subscribe(listener: () => void): () => void;
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

export interface RepositoryConnectionStatus {
  state: "connecting" | "connected" | "unavailable";
  lastReachedAt?: string;
  message?: string;
}

export interface RefreshResult {
  scanned: number;
  changed: number;
  removed: number;
  elapsedMs: number;
}

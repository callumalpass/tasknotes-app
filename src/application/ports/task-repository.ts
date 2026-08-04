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
  SaveScratchpadInput,
  ScratchpadArchiveResult,
  ScratchpadDocument,
} from "../../domain/scratchpad";
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
  delete(id: string): Promise<void>;
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
  /** Typed collection document used by the first-class Scratchpad view. */
  getActiveScratchpad?(): Promise<ScratchpadDocument>;
  saveScratchpad?(input: SaveScratchpadInput): Promise<ScratchpadDocument>;
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

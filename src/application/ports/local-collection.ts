import type { Task } from "../../domain/task";
import type {
  TaskViewSourceDocument,
  TaskViewDocument,
} from "../../domain/view";
import type { ScratchpadDocument } from "../../domain/scratchpad";
import type { ScratchImage } from "../../domain/scratch-image";
import type { CollectionFile } from "./collection-file-store";

export interface LocalFileEntry {
  file: CollectionFile;
  bytes: Blob;
}

/** A complete local collection checkpoint, committed atomically by its host. */
export interface CollectionSnapshot {
  id: string;
  modelDefinition: Record<string, unknown>;
  settingsRecord?: Record<string, unknown>;
  tasks: Task[];
  sources: TaskViewSourceDocument[];
  documents: TaskViewDocument[];
  scratchpads: ScratchpadDocument[];
  scratchImages: ScratchImage[];
  sourceRevision: number;
  files: LocalFileEntry[];
}

export interface TransferLedger {
  key: string;
  destination: string;
  createdAt: number;
  source: CollectionSnapshot;
  plan: import("../local-transfer").TaskTransferPlan;
  prepared: import("./task-import").ImportedRecord[];
  records: Record<
    string,
    { id: string; mutationId: string; attempted?: boolean; confirmed?: boolean }
  >;
  files: Record<
    string,
    { path: string; attempted?: boolean; confirmed?: boolean }
  >;
  completed?: boolean;
}

import type { Task } from "../../domain/task";
import type { TaskCollectionConfiguration } from "../../domain/task-configuration";

export interface TaskImportTarget {
  typeName: string;
  configuration: TaskCollectionConfiguration;
  /** Detect definition or binding changes between review and submission. */
  fingerprint: string;
}
export interface ImportedRecord {
  key: string;
  id: string;
  type: string;
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  targetFingerprint?: string;
}
export interface TaskImportPort {
  targets(): Promise<TaskImportTarget[]>;
  prepareTask(
    task: Task,
    target: TaskImportTarget,
    id: string,
  ): Promise<ImportedRecord>;
  /** A confirmed-only create. Recovery checks the original mutation's receipt. */
  write(
    record: ImportedRecord,
    mutationId: string,
    recovering: boolean,
  ): Promise<void>;
}

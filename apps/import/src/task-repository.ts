import type { DestinationType, PlannedTask } from "./plan";

export interface ImportReport {
  sourceId: string;
  path: string;
  status: "created" | "skipped" | "failed" | "uncertain" | "not-started";
  mutationId?: string;
  message?: string;
}

export interface TaskRepository {
  isCurrent(): boolean;
  discoverTypes(): Promise<DestinationType[]>;
  importTasks(
    plan: readonly PlannedTask[],
    onProgress: (report: ImportReport[]) => void,
    signal?: AbortSignal,
  ): Promise<ImportReport[]>;
  recoverWrites(
    mutationIds: readonly string[],
    plan: readonly PlannedTask[],
    report: readonly ImportReport[],
    onProgress: (report: ImportReport[]) => void,
  ): Promise<void>;
}

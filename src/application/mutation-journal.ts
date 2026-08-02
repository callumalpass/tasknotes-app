import type { UpdateTaskInput } from "../domain/task";

export interface PendingTaskDeletion {
  kind: "delete-task";
  operationId: string;
  collectionId: string;
  taskId: string;
  title: string;
  requestedAt: number;
  commitAfter: number;
}

export interface PendingTaskUpdateBatch {
  kind: "update-tasks";
  operationId: string;
  collectionId: string;
  requestedAt: number;
  updates: Array<{ id: string; input: UpdateTaskInput }>;
}

export type DurableTaskCommand = PendingTaskDeletion | PendingTaskUpdateBatch;

/**
 * Durable application intent that is separate from task data and projections.
 * Implementations must make `put` and `remove` durable before resolving.
 */
export interface MutationJournal {
  list(collectionId: string): Promise<DurableTaskCommand[]>;
  put(command: DurableTaskCommand): Promise<void>;
  remove(operationId: string): Promise<void>;
  close?(): void;
}

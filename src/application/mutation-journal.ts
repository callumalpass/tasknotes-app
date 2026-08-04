export interface PendingTaskDeletion {
  kind: "delete-task";
  operationId: string;
  collectionId: string;
  taskId: string;
  title: string;
  /** SDK mutation request paired with this app intent after an unknown outcome. */
  authorityRequestId?: string;
  requestedAt: number;
  commitAfter: number;
}

export type DurableTaskCommand = PendingTaskDeletion;

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

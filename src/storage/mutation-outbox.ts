import type { Task } from "../domain/task";

interface PendingLocalMutationBase {
  taskId: string;
  operationId: string;
  enqueuedAt: number;
  attempts: number;
  lastAttemptAt?: number;
  lastError?: string;
}

export interface PendingTaskWrite extends PendingLocalMutationBase {
  kind: "write";
  task: Task;
}

export interface PendingTaskMove extends PendingLocalMutationBase {
  kind: "move";
  task: Task;
  from: string;
  to: string;
  sourceWritten?: boolean;
}

export interface PendingTaskDelete extends PendingLocalMutationBase {
  kind: "delete";
  path: string;
}

export type PendingLocalMutation =
  PendingTaskWrite | PendingTaskMove | PendingTaskDelete;

export function pendingTaskWrite(task: Task): PendingTaskWrite {
  return mutationBase(task.id, { kind: "write", task });
}

export function pendingTaskMove(task: Task, to: string): PendingTaskMove {
  return mutationBase(task.id, {
    kind: "move",
    task,
    from: task.path,
    to,
  });
}

export function pendingTaskDelete(task: Task): PendingTaskDelete {
  return mutationBase(task.id, { kind: "delete", path: task.path });
}

export function recordMutationFailure(
  mutation: PendingLocalMutation,
  reason: unknown,
): PendingLocalMutation {
  return {
    ...mutation,
    attempts: mutation.attempts + 1,
    lastAttemptAt: Date.now(),
    lastError: reason instanceof Error ? reason.message : String(reason),
  };
}

function mutationBase<
  T extends Omit<PendingLocalMutation, keyof PendingLocalMutationBase>,
>(taskId: string, mutation: T): T & PendingLocalMutationBase {
  return {
    ...mutation,
    taskId,
    operationId: crypto.randomUUID(),
    enqueuedAt: Date.now(),
    attempts: 0,
  };
}

import type { Task, UpdateTaskInput } from "../domain/task";
import type { CollectionInfo } from "./ports/task-repository";
import type { MutationJournal, PendingTaskDeletion } from "./mutation-journal";
import { toOperationalError } from "./operational-error";

import type { OperationalError } from "./operational-error";

const DEFAULT_UNDO_WINDOW_MS = 30_000;

export interface TaskCommandRepository {
  get(id: string): Promise<Task | null>;
  delete(id: string, options?: { authorityRequestId?: string }): Promise<void>;
  update(id: string, input: UpdateTaskInput): Promise<Task>;
  updateMany(
    updates: readonly { id: string; input: UpdateTaskInput }[],
  ): Promise<Task[]>;
  collectionInfo(): Promise<CollectionInfo>;
}

export interface TaskCommandSnapshot {
  pendingDeletion: PendingTaskDeletion | null;
  deletionError: OperationalError | null;
}

interface TaskCommandClock {
  now(): number;
  setTimeout(
    callback: () => void,
    delay: number,
  ): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

const systemClock: TaskCommandClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (handle) => clearTimeout(handle),
};

/**
 * Coordinates delayed deletions whose undo window must survive application
 * shutdown. Other task changes go straight to the repository.
 */
export class TaskCommandService {
  private collectionId: string | null = null;
  private pendingDeletion: PendingTaskDeletion | null = null;
  private deletionError: OperationalError | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tail: Promise<void> = Promise.resolve();
  private disposed = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly options: {
      repository: TaskCommandRepository;
      journal: MutationJournal;
      onDeleted?(taskId: string): Promise<void>;
      onTasksUpdated?(
        tasks: readonly Task[],
        updates: readonly { id: string; input: UpdateTaskInput }[],
      ): Promise<void>;
      undoWindowMs?: number;
      clock?: TaskCommandClock;
    },
  ) {}

  async initialize(): Promise<void> {
    const info = await this.options.repository.collectionInfo();
    this.collectionId = collectionIdentity(info);
    const commands = (await this.options.journal.list(this.collectionId)).sort(
      (left, right) => left.requestedAt - right.requestedAt,
    );
    const deletions = commands.sort(
      (left, right) => left.requestedAt - right.requestedAt,
    );

    // The UI currently presents one undo operation. Any older accepted command
    // is completed before the newest command is restored.
    for (const deletion of deletions.slice(0, -1))
      await this.commitDeletionNow(deletion).catch(() => undefined);
    const latest = deletions.at(-1) ?? null;
    if (!latest) return;
    if (latest.commitAfter <= this.clock.now()) {
      await this.commitDeletionNow(latest).catch(() => undefined);
      return;
    }
    this.pendingDeletion = latest;
    this.schedule(latest);
    this.publish();
  }

  snapshot(): TaskCommandSnapshot {
    return {
      pendingDeletion: this.pendingDeletion
        ? { ...this.pendingDeletion }
        : null,
      deletionError: this.deletionError,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  requestDeletion(taskId: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.collectionId)
        throw new Error("Task commands have not been initialized.");
      if (this.pendingDeletion?.taskId === taskId) return;
      if (this.pendingDeletion)
        await this.commitDeletionNow(this.pendingDeletion);
      const task = await this.options.repository.get(taskId);
      if (!task) return;
      const requestedAt = this.clock.now();
      const command: PendingTaskDeletion = {
        kind: "delete-task",
        operationId: crypto.randomUUID(),
        collectionId: this.collectionId,
        taskId,
        title: task.title,
        requestedAt,
        commitAfter:
          requestedAt + (this.options.undoWindowMs ?? DEFAULT_UNDO_WINDOW_MS),
      };
      await this.options.journal.put(command);
      this.pendingDeletion = command;
      this.deletionError = null;
      this.schedule(command);
      this.publish();
    });
  }

  updateTasks(
    updates: readonly { id: string; input: UpdateTaskInput }[],
  ): Promise<Task[]> {
    return this.enqueue(async () => {
      if (!updates.length) return [];
      try {
        const tasks = await this.options.repository.updateMany(updates);
        await this.options.onTasksUpdated?.(tasks, updates);
        return tasks;
      } catch (reason) {
        throw toOperationalError(reason, "update-tasks");
      }
    });
  }

  undoDeletion(): Promise<void> {
    return this.enqueue(async () => {
      const pending = this.pendingDeletion;
      if (!pending) return;
      await this.options.journal.remove(pending.operationId);
      this.clearTimer();
      this.pendingDeletion = null;
      this.deletionError = null;
      this.publish();
    });
  }

  retryDeletion(): Promise<void> {
    return this.enqueue(async () => {
      if (this.pendingDeletion)
        await this.commitDeletionNow(this.pendingDeletion);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.listeners.clear();
  }

  private schedule(command: PendingTaskDeletion): void {
    this.clearTimer();
    const remaining = Math.max(0, command.commitAfter - this.clock.now());
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      void this.enqueue(() => this.commitDeletionNow(command)).catch(
        () => undefined,
      );
    }, remaining);
  }

  private async commitDeletionNow(command: PendingTaskDeletion): Promise<void> {
    this.clearTimer();
    try {
      if (command.authorityRequestId)
        await this.options.repository.delete(command.taskId, {
          authorityRequestId: command.authorityRequestId,
        });
      else await this.options.repository.delete(command.taskId);
      await this.options.onDeleted?.(command.taskId);
      await this.options.journal.remove(command.operationId);
      if (this.pendingDeletion?.operationId === command.operationId)
        this.pendingDeletion = null;
      this.deletionError = null;
    } catch (reason) {
      const authorityRequestId = durableRequestId(reason);
      if (
        authorityRequestId &&
        command.authorityRequestId !== authorityRequestId
      ) {
        command = { ...command, authorityRequestId };
        await this.options.journal.put(command);
        if (this.pendingDeletion?.operationId === command.operationId)
          this.pendingDeletion = command;
      }
      const failure = toOperationalError(reason, "delete-task");
      if (this.pendingDeletion?.operationId !== command.operationId)
        this.pendingDeletion = command;
      this.deletionError = failure;
      throw failure;
    } finally {
      this.publish();
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(operation, operation);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private publish(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener();
  }

  private get clock(): TaskCommandClock {
    return this.options.clock ?? systemClock;
  }
}

function durableRequestId(reason: unknown): string | null {
  if (!reason || typeof reason !== "object") return null;
  const carrier = reason as {
    details?: unknown;
    problem?: { details?: unknown };
  };
  const details = carrier.details ?? carrier.problem?.details;
  if (!details || typeof details !== "object" || !("request_id" in details))
    return null;
  const requestId = details.request_id;
  return typeof requestId === "string" && requestId ? requestId : null;
}

function collectionIdentity(info: CollectionInfo): string {
  return `${info.kind}:${info.id ?? info.location}`;
}

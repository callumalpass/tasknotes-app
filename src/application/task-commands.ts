import { t } from "@lingui/core/macro";
import { isMdbaseError } from "@mdbase-dev/sdk";
import type { Task, TaskSummary, UpdateTaskInput } from "../domain/task";
import {
  TaskDeletionNotStartedError,
  type CollectionInfo,
} from "./ports/task-repository";
import type { MutationJournal, PendingTaskDeletion } from "./mutation-journal";
import { OperationalError, toOperationalError } from "./operational-error";
import { acceptedWriteEffect } from "./accepted-task-effects";

const DEFAULT_UNDO_WINDOW_MS = 30_000;

export interface TaskCommandRepository {
  getSummary(id: string): Promise<TaskSummary | null>;
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
  private foreground = true;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly options: {
      repository: TaskCommandRepository;
      journal: MutationJournal | null;
      discardPendingRequest?(requestId: string): Promise<void>;
      onDeleted?(taskId: string): Promise<void>;
      onTasksUpdated?(
        tasks: readonly Task[],
        updates: readonly { id: string; input: UpdateTaskInput }[],
      ): Promise<Task[] | void>;
      undoWindowMs?: number;
      clock?: TaskCommandClock;
    },
  ) {}

  async initialize(): Promise<void> {
    const info = await this.options.repository.collectionInfo();
    this.collectionId = collectionIdentity(info);
    // Online-only sessions have an Undo window, but no durable delete intent.
    if (!this.options.journal) return;
    const deletions = (await this.options.journal.list(this.collectionId)).sort(
      (left, right) => left.requestedAt - right.requestedAt,
    );

    const outcomeUnknown = deletions.find(
      (deletion) => deletion.authorityRequestId,
    );
    if (outcomeUnknown) {
      this.pendingDeletion = outcomeUnknown;
      this.deletionError = new OperationalError(
        "outcome-unknown",
        "delete-task",
        false,
        "TaskNotes retained the exact mdbase request because the earlier deletion outcome is unknown.",
      );
      this.publish();
      return;
    }

    // The UI currently presents one undo operation. Any older accepted command
    // is completed before the newest command is restored.
    for (const deletion of deletions.slice(0, -1))
      await this.commitDeletionNow(deletion).catch(() => undefined);
    const latest = deletions.at(-1) ?? null;
    if (!latest) return;
    // Hidden, the undo window is not offered: finish the deletion now.
    if (!this.foreground || latest.commitAfter <= this.clock.now()) {
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

  requestDeletion(taskIds: string | readonly string[]): Promise<void> {
    return this.enqueue(async () => {
      if (!this.collectionId)
        throw new Error("Task commands have not been initialized.");
      const ids =
        typeof taskIds === "string" ? [taskIds] : [...new Set(taskIds)];
      if (!ids.length) return;
      if (
        ids.length === 1 &&
        this.pendingDeletion?.taskId === ids[0] &&
        !this.pendingDeletion.additionalTasks?.length
      )
        return;
      if (this.pendingDeletion)
        await this.commitDeletionNow(this.pendingDeletion);
      const tasks = await Promise.all(
        ids.map((id) => this.options.repository.getSummary(id)),
      );
      if (ids.length === 1 && !tasks[0]) return;
      if (tasks.some((task) => !task))
        throw new Error(
          t({
            message: "A selected task no longer exists. Review the selection.",
          }),
        );
      const task = tasks[0]!;
      const requestedAt = this.clock.now();
      const command: PendingTaskDeletion = {
        kind: "delete-task",
        operationId: crypto.randomUUID(),
        collectionId: this.collectionId,
        taskId: task.id,
        title: task.title,
        ...(typeof taskIds !== "string"
          ? {
              additionalTasks: tasks
                .slice(1)
                .map((task) => ({ taskId: task!.id, title: task!.title })),
            }
          : {}),
        requestedAt,
        commitAfter:
          requestedAt + (this.options.undoWindowMs ?? DEFAULT_UNDO_WINDOW_MS),
      };
      await this.options.journal?.put(command);
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
      let tasks: Task[];
      try {
        tasks = await this.options.repository.updateMany(updates);
      } catch (reason) {
        throw toOperationalError(reason, "update-tasks");
      }
      const warning = await acceptedWriteEffect(
        "update follow-up could not complete",
        async () => {
          tasks =
            (await this.options.onTasksUpdated?.(tasks, updates)) ?? tasks;
        },
      );
      return warning
        ? tasks.map((task) => ({
            ...task,
            operationWarnings: [...(task.operationWarnings ?? []), warning],
          }))
        : tasks;
    });
  }

  undoDeletion(): Promise<void> {
    return this.enqueue(async () => {
      const pending = this.pendingDeletion;
      if (!pending) return;
      if (pending.authorityRequestId) {
        if (!this.options.discardPendingRequest)
          throw new OperationalError(
            "unknown",
            "discard-pending-deletion",
            false,
            "Saved mdbase recovery cannot be discarded safely in this session.",
          );
        await this.options.discardPendingRequest(pending.authorityRequestId);
      }
      await this.options.journal?.remove(pending.operationId);
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

  /**
   * Undo is offered only while TaskNotes is on screen. Hiding it finishes the
   * pending deletion at once rather than holding it until TaskNotes returns, so
   * other devices and apps stop showing the task. The returned promise settles
   * once that commit has finished or failed; callers suspend the repository
   * only afterwards, so suspension cannot cancel the delete it is waiting on.
   */
  setForeground(active: boolean): Promise<void> {
    this.foreground = active;
    this.clearTimer();
    if (!active) return this.commitWhileHidden();
    if (this.pendingDeletion && !this.deletionError)
      this.schedule(this.pendingDeletion);
    return Promise.resolve();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.listeners.clear();
  }

  private commitWhileHidden(): Promise<void> {
    return this.enqueue(async () => {
      const pending = this.pendingDeletion;
      // A failed or outcome-unknown deletion keeps its review/retry path; a
      // return to the foreground before this runs keeps the undo window.
      if (
        this.foreground ||
        this.disposed ||
        !pending ||
        this.deletionError ||
        pending.authorityRequestId
      )
        return;
      const due: PendingTaskDeletion = {
        ...pending,
        commitAfter: Math.min(pending.commitAfter, this.clock.now()),
      };
      // Record that the window is over first: if the process dies before the
      // delete settles, the next launch commits it instead of offering Undo.
      await this.options.journal.put(due).catch(() => undefined);
      this.pendingDeletion = due;
      await this.commitDeletionNow(due);
    }).catch(() => undefined);
  }

  private schedule(command: PendingTaskDeletion): void {
    this.clearTimer();
    if (!this.foreground || this.disposed) return;
    const remaining = Math.max(0, command.commitAfter - this.clock.now());
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      void this.enqueue(async () => {
        if (
          this.foreground &&
          !this.disposed &&
          !this.deletionError &&
          this.pendingDeletion?.operationId === command.operationId
        )
          await this.commitDeletionNow(command);
      }).catch(() => undefined);
    }, remaining);
  }

  private async commitDeletionNow(command: PendingTaskDeletion): Promise<void> {
    this.clearTimer();
    try {
      if (this.disposed && !this.options.journal) return;
      if (command.authorityRequestId)
        await this.options.repository.delete(command.taskId, {
          authorityRequestId: command.authorityRequestId,
        });
      else await this.options.repository.delete(command.taskId);
      await acceptedWriteEffect("deletion follow-up could not complete", () =>
        this.options.onDeleted?.(command.taskId),
      );
      if (command.additionalTasks?.length) {
        const [next, ...rest] = command.additionalTasks;
        const remaining: PendingTaskDeletion = {
          ...command,
          taskId: next.taskId,
          title: next.title,
          additionalTasks: rest,
        };
        delete remaining.authorityRequestId;
        // Persist progress before issuing another delete. Restart and Undo retain
        // only uncommitted rows, never recreate an already deleted task.
        command = remaining;
        this.pendingDeletion = remaining;
        await this.options.journal?.put(remaining);
        this.publish();
        return this.commitDeletionNow(remaining);
      }
      await acceptedWriteEffect(
        "the accepted deletion's recovery journal could not be cleared",
        async () => {
          await this.options.journal?.remove(command.operationId);
        },
      );
      if (this.pendingDeletion?.operationId === command.operationId)
        this.pendingDeletion = null;
      this.deletionError = null;
    } catch (reason) {
      if (!this.options.journal) {
        this.pendingDeletion = null;
        this.deletionError = toOperationalError(reason, "delete-task");
        throw this.deletionError;
      }
      if (
        reason instanceof TaskDeletionNotStartedError &&
        !command.authorityRequestId
      ) {
        this.pendingDeletion = command;
        this.deletionError = null;
        this.schedule(command);
        throw reason;
      }
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
  return isMdbaseError(reason, "outcome_unknown")
    ? (reason.mutationId ?? null)
    : null;
}

function collectionIdentity(info: CollectionInfo): string {
  return `${info.kind}:${info.id ?? info.location}`;
}

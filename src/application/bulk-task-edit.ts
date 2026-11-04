import { rescheduleInput } from "../domain/task-date-actions";
import type { Task, TaskSummary, UpdateTaskInput } from "../domain/task";

export type BulkTaskChange =
  | { kind: "complete" }
  | { kind: "schedule"; date: string | null }
  | { kind: "priority"; value: string }
  | { kind: "project"; value: string }
  | { kind: "archive" };
export interface BulkEditReceipt {
  before: TaskSummary;
  saved: Task;
  undo: UpdateTaskInput;
}
export interface BulkEditFailure {
  task: TaskSummary;
  reason: unknown;
}
export interface BulkEditPort {
  getSummary(id: string): Promise<TaskSummary | null>;
  updateTask(id: string, input: UpdateTaskInput): Promise<Task>;
  setTaskArchived(id: string, archived: boolean): Promise<Task>;
}

/** Each row uses the existing guarded write path. Never retry a refused write. */
export async function applyBulkEdits(
  tasks: readonly TaskSummary[],
  plan: (task: TaskSummary) => {
    input: UpdateTaskInput;
    undo: UpdateTaskInput;
  },
  port: BulkEditPort,
  changedMessage: string,
  archive = false,
) {
  const receipts: BulkEditReceipt[] = [],
    failures: BulkEditFailure[] = [];
  for (const before of tasks) {
    try {
      const current = await port.getSummary(before.id);
      if (!current || current.revision !== before.revision)
        throw new Error(changedMessage);
      const { input, undo } = plan(before);
      const saved = archive
        ? await port.setTaskArchived(before.id, Boolean(input.archived))
        : await port.updateTask(before.id, input);
      receipts.push({ before, saved, undo });
    } catch (reason) {
      failures.push({ task: before, reason });
    }
  }
  return { receipts, failures };
}

/** Undo checks the accepted revision too; it must not overwrite a later edit. */
export async function undoBulkEdits(
  receipts: readonly BulkEditReceipt[],
  port: BulkEditPort,
  changedMessage: string,
) {
  const failures: BulkEditFailure[] = [],
    remaining: BulkEditReceipt[] = [];
  for (const receipt of receipts) {
    try {
      const current = await port.getSummary(receipt.saved.id);
      if (!current || current.revision !== receipt.saved.revision)
        throw new Error(changedMessage);
      if ("archived" in receipt.undo)
        await port.setTaskArchived(current.id, Boolean(receipt.undo.archived));
      else await port.updateTask(current.id, receipt.undo);
    } catch (reason) {
      failures.push({ task: receipt.before, reason });
      remaining.push(receipt);
    }
  }
  return { failures, remaining };
}

function rescheduleChange(task: TaskSummary, date: string | null) {
  const input = date ? rescheduleInput(task, date) : { scheduled: null };
  return {
    input,
    undo: {
      scheduled: task.scheduled ?? null,
      ...("due" in input ? { due: task.due ?? null } : {}),
    },
  };
}

export function planTaskChange(task: TaskSummary, change: BulkTaskChange) {
  switch (change.kind) {
    case "complete":
      return {
        input: { completed: true },
        undo: { completed: task.completed, status: task.status },
      };
    case "schedule":
      return {
        ...rescheduleChange(task, change.date),
      };
    case "priority":
      return {
        input: { priority: change.value },
        undo: { priority: task.priority },
      };
    case "project":
      return {
        input: { projects: change.value ? [change.value] : [] },
        undo: { projects: [...task.projects] },
      };
    case "archive":
      return { input: { archived: true }, undo: { archived: task.archived } };
  }
}

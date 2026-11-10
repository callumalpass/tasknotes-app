import { createContext } from "react";

import type { TaskSummary } from "../domain/task";

/** A completed row stays readable this long before it folds away. */
export const COMPLETION_LINGER_MS = 500;
export const COMPLETION_FOLD_MS = 200;

/**
 * Rows a list keeps on screen only so a completion can finish in place: task
 * ID to the time the completion was accepted, or null while it is unconfirmed.
 * Such a row is inert and folds away once it has lingered.
 */
export const TaskDeparturesContext = createContext<
  ReadonlyMap<string, number | null>
>(new Map());

/**
 * Every completion a view is holding, whether or not its row has left yet, for
 * presentations that build rows from their own task list rather than results.
 */
export const TaskCompletionHoldsContext = createContext<
  ReadonlyMap<string, number | null>
>(new Map());

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface TaskCompletion {
  task: TaskSummary;
  completed?: boolean;
  occurrenceDate?: string;
  /** The day a completion was recorded for, when it was not left to default. */
  on?: string;
  /** Dates a repeating task advanced on completion, which Undo puts back. */
  advanced?: { scheduled: string | null; due: string | null };
}

export function completionRecord(
  task: TaskSummary,
  occurrenceDate: string | undefined,
  saved: unknown,
): TaskCompletion {
  if (occurrenceDate || !task.recurrence || !saved || typeof saved !== "object")
    return { task, occurrenceDate };
  const next = saved as Partial<TaskSummary>;
  const instance = next.completeInstances?.find(
    (date) => !task.completeInstances.includes(date),
  );
  const moved = next.scheduled !== task.scheduled || next.due !== task.due;
  return {
    task,
    occurrenceDate: instance,
    ...(moved
      ? {
          advanced: {
            scheduled: task.scheduled ?? null,
            due: task.due ?? null,
          },
        }
      : {}),
  };
}

/**
 * A completion recorded for a chosen day. A repeating task has that day's
 * occurrence ticked, and its dates may move on; any other task is completed
 * as a whole, so Undo reopens the record.
 */
export function datedCompletionRecord(
  task: TaskSummary,
  date: string,
  saved: unknown,
): TaskCompletion {
  if (!task.recurrence) return { task, on: date };
  const next =
    saved && typeof saved === "object" ? (saved as Partial<TaskSummary>) : {};
  const moved =
    ("scheduled" in next && next.scheduled !== task.scheduled) ||
    ("due" in next && next.due !== task.due);
  return {
    task,
    occurrenceDate: date,
    on: date,
    ...(moved
      ? {
          advanced: {
            scheduled: task.scheduled ?? null,
            due: task.due ?? null,
          },
        }
      : {}),
  };
}

/** Rows report an accepted completion so the shell can offer Undo. */
export const TaskCompletionReportContext = createContext<
  (completion: TaskCompletion) => void
>(() => undefined);

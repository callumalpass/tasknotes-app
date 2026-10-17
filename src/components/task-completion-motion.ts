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
  occurrenceDate?: string;
  /** Dates a repeating task advanced on completion, which Undo puts back. */
  advanced?: { scheduled: string | null; due: string | null };
}

/** Rows report an accepted completion so the shell can offer Undo. */
export const TaskCompletionReportContext = createContext<
  (completion: TaskCompletion) => void
>(() => undefined);

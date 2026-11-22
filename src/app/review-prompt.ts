import { todayString } from "../domain/task";

/**
 * When to ask the OS for a store review. Kept per device in browser storage:
 * the first day TaskNotes was used here, the last few days a task was
 * completed, and when a review was last requested. The OS may still show
 * nothing; it applies its own limits.
 */
export interface ReviewPromptState {
  /** Local day (YYYY-MM-DD) TaskNotes was first used on this device. */
  firstUsed?: string;
  /** Distinct local days a task was completed, most recent last. */
  completionDays: string[];
  /** Epoch milliseconds of the last review request. */
  lastRequested?: number;
}

export const REVIEW_PROMPT_COMPLETION_DAYS = 3;
export const REVIEW_PROMPT_MIN_AGE_DAYS = 4;
export const REVIEW_PROMPT_COOLDOWN_DAYS = 120;

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function emptyReviewPromptState(): ReviewPromptState {
  return { completionDays: [] };
}

export function parseReviewPromptState(raw: string | null): ReviewPromptState {
  try {
    const value = JSON.parse(raw ?? "null") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value))
      return emptyReviewPromptState();
    const stored = value as Record<string, unknown>;
    const days = Array.isArray(stored.completionDays)
      ? stored.completionDays.filter(
          (day): day is string => typeof day === "string" && DAY.test(day),
        )
      : [];
    return {
      ...(typeof stored.firstUsed === "string" && DAY.test(stored.firstUsed)
        ? { firstUsed: stored.firstUsed }
        : {}),
      completionDays: days.slice(-REVIEW_PROMPT_COMPLETION_DAYS),
      ...(typeof stored.lastRequested === "number" &&
      Number.isFinite(stored.lastRequested)
        ? { lastRequested: stored.lastRequested }
        : {}),
    };
  } catch {
    return emptyReviewPromptState();
  }
}

/** Remember the first day of use; later days leave it alone. */
export function recordFirstUse(
  state: ReviewPromptState,
  now: Date,
): ReviewPromptState {
  return state.firstUsed ? state : { ...state, firstUsed: todayString(now) };
}

/**
 * Record a completed task. `request` is true when this completion is a good
 * moment to ask for a review: tasks completed on enough distinct days, first
 * used long enough ago, and no request within the cooldown.
 */
export function recordCompletion(
  state: ReviewPromptState,
  now: Date,
): { state: ReviewPromptState; request: boolean } {
  const today = todayString(now);
  const withFirstUse = recordFirstUse(state, now);
  const next: ReviewPromptState = {
    ...withFirstUse,
    completionDays: state.completionDays.includes(today)
      ? state.completionDays
      : [...state.completionDays, today].slice(-REVIEW_PROMPT_COMPLETION_DAYS),
  };
  const firstUsed = next.firstUsed ?? today;
  const request =
    next.completionDays.length >= REVIEW_PROMPT_COMPLETION_DAYS &&
    daysBetween(firstUsed, today) >= REVIEW_PROMPT_MIN_AGE_DAYS &&
    (next.lastRequested === undefined ||
      now.getTime() - next.lastRequested >=
        REVIEW_PROMPT_COOLDOWN_DAYS * DAY_MS);
  return { state: next, request };
}

export function recordReviewRequested(
  state: ReviewPromptState,
  now: Date,
): ReviewPromptState {
  return { ...state, lastRequested: now.getTime() };
}

/** Whole calendar days from one local day to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

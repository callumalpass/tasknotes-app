import { useCallback, useEffect, useRef } from "react";
import type { TaskCompletion } from "../components/task-completion-motion";
import { nativeStoreReview, type StoreReview } from "../native/store-review";
import {
  parseReviewPromptState,
  recordCompletion,
  recordFirstUse,
  recordReviewRequested,
  type ReviewPromptState,
} from "./review-prompt";

export const REVIEW_PROMPT_STORAGE_KEY = "tasknotes:review-prompt:v1";
/** Let the completion land (check, haptic, Undo) before the OS sheet. */
export const REVIEW_PROMPT_DELAY_MS = 1500;

/**
 * Returns a completion listener that may ask the OS for a store review.
 * Nothing happens on the web. `blocked` holds back the request while
 * something else needs attention: an error, an open editor or capture.
 */
export function useStoreReviewPrompt(
  blocked: boolean,
  review: StoreReview = nativeStoreReview,
): (completion: TaskCompletion) => void {
  const blockedRef = useRef(blocked);
  useEffect(() => {
    blockedRef.current = blocked;
  });
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (review.available) save(recordFirstUse(load(), new Date()));
    return () => window.clearTimeout(timer.current);
  }, [review]);
  return useCallback(
    (completion: TaskCompletion) => {
      // `completed: false` reports a reopened task.
      if (!review.available || completion.completed === false) return;
      const { state, request } = recordCompletion(load(), new Date());
      save(state);
      if (!request || blockedRef.current) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (blockedRef.current || modalOpen()) return;
        save(recordReviewRequested(load(), new Date()));
        void review.request().catch(() => undefined);
      }, REVIEW_PROMPT_DELAY_MS);
    },
    [review],
  );
}

function modalOpen(): boolean {
  return Boolean(document.querySelector('[aria-modal="true"], dialog[open]'));
}

function load(): ReviewPromptState {
  try {
    return parseReviewPromptState(
      window.localStorage.getItem(REVIEW_PROMPT_STORAGE_KEY),
    );
  } catch {
    return parseReviewPromptState(null);
  }
}

function save(state: ReviewPromptState): void {
  try {
    window.localStorage.setItem(
      REVIEW_PROMPT_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    // Without storage the conditions are never met, so nothing is asked.
  }
}

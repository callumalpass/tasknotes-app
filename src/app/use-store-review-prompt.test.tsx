import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskCompletion } from "../components/task-completion-motion";
import type { TaskSummary } from "../domain/task";
import type { StoreReview } from "../native/store-review";
import {
  REVIEW_PROMPT_DELAY_MS,
  REVIEW_PROMPT_STORAGE_KEY,
  useStoreReviewPrompt,
} from "./use-store-review-prompt";

const completion = {
  task: { id: "a", title: "A" } as TaskSummary,
} satisfies TaskCompletion;

function fakeReview(available = true) {
  return {
    available,
    request: vi.fn(() => Promise.resolve()),
  } satisfies StoreReview;
}

/** Three completion days, first used five days ago. */
function seedReadyState() {
  localStorage.setItem(
    REVIEW_PROMPT_STORAGE_KEY,
    JSON.stringify({
      firstUsed: "2026-11-17",
      completionDays: ["2026-11-18", "2026-11-20"],
    }),
  );
}

function stored() {
  return JSON.parse(localStorage.getItem(REVIEW_PROMPT_STORAGE_KEY) ?? "null");
}

describe("useStoreReviewPrompt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T10:00:00"));
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("asks the OS after a completion that meets the rules", async () => {
    seedReadyState();
    const review = fakeReview();
    const { result } = renderHook(() => useStoreReviewPrompt(false, review));
    act(() => result.current(completion));
    expect(review.request).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(REVIEW_PROMPT_DELAY_MS));
    expect(review.request).toHaveBeenCalledTimes(1);
    expect(stored().lastRequested).toBe(Date.now());
    // A second completion inside the cooldown asks nothing.
    act(() => result.current(completion));
    await act(() => vi.advanceTimersByTimeAsync(REVIEW_PROMPT_DELAY_MS));
    expect(review.request).toHaveBeenCalledTimes(1);
  });

  it("does nothing on the web", async () => {
    seedReadyState();
    const before = localStorage.getItem(REVIEW_PROMPT_STORAGE_KEY);
    const review = fakeReview(false);
    const { result } = renderHook(() => useStoreReviewPrompt(false, review));
    act(() => result.current(completion));
    await act(() => vi.advanceTimersByTimeAsync(REVIEW_PROMPT_DELAY_MS));
    expect(review.request).not.toHaveBeenCalled();
    expect(localStorage.getItem(REVIEW_PROMPT_STORAGE_KEY)).toBe(before);
  });

  it("records first use on launch and never asks then", async () => {
    const review = fakeReview();
    const { result } = renderHook(() => useStoreReviewPrompt(false, review));
    expect(stored().firstUsed).toBe("2026-11-22");
    act(() => result.current(completion));
    await act(() => vi.advanceTimersByTimeAsync(REVIEW_PROMPT_DELAY_MS));
    expect(review.request).not.toHaveBeenCalled();
  });

  it("ignores a reopened task", async () => {
    seedReadyState();
    const review = fakeReview();
    const { result } = renderHook(() => useStoreReviewPrompt(false, review));
    act(() => result.current({ ...completion, completed: false }));
    await act(() => vi.advanceTimersByTimeAsync(REVIEW_PROMPT_DELAY_MS));
    expect(review.request).not.toHaveBeenCalled();
    expect(stored().completionDays).toHaveLength(2);
  });

  it("holds back while blocked but still counts the day", async () => {
    seedReadyState();
    const review = fakeReview();
    const { result, rerender } = renderHook(
      ({ blocked }) => useStoreReviewPrompt(blocked, review),
      { initialProps: { blocked: true } },
    );
    act(() => result.current(completion));
    await act(() => vi.advanceTimersByTimeAsync(REVIEW_PROMPT_DELAY_MS));
    expect(review.request).not.toHaveBeenCalled();
    expect(stored().completionDays).toContain("2026-11-22");
    rerender({ blocked: false });
    act(() => result.current(completion));
    await act(() => vi.advanceTimersByTimeAsync(REVIEW_PROMPT_DELAY_MS));
    expect(review.request).toHaveBeenCalledTimes(1);
  });

  it("holds back when something becomes blocked during the delay", async () => {
    seedReadyState();
    const review = fakeReview();
    const { result, rerender } = renderHook(
      ({ blocked }) => useStoreReviewPrompt(blocked, review),
      { initialProps: { blocked: false } },
    );
    act(() => result.current(completion));
    rerender({ blocked: true });
    await act(() => vi.advanceTimersByTimeAsync(REVIEW_PROMPT_DELAY_MS));
    expect(review.request).not.toHaveBeenCalled();
    expect(stored().lastRequested).toBeUndefined();
  });

  it("holds back while a modal dialog is open", async () => {
    seedReadyState();
    const review = fakeReview();
    const { result } = renderHook(() => useStoreReviewPrompt(false, review));
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    act(() => result.current(completion));
    await act(() => vi.advanceTimersByTimeAsync(REVIEW_PROMPT_DELAY_MS));
    expect(review.request).not.toHaveBeenCalled();
  });

  it("tolerates a failed OS request", async () => {
    seedReadyState();
    const review = fakeReview();
    review.request.mockRejectedValueOnce(new Error("unavailable"));
    const { result } = renderHook(() => useStoreReviewPrompt(false, review));
    act(() => result.current(completion));
    await act(() => vi.advanceTimersByTimeAsync(REVIEW_PROMPT_DELAY_MS));
    expect(review.request).toHaveBeenCalledTimes(1);
  });
});

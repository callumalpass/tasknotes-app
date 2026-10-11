import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useCollapseOnScroll } from "./use-collapse-on-scroll";

beforeEach(() => {
  vi.useFakeTimers();
  // Run each frame at once; a zero handle lets the next scroll schedule again.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 0;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.scrollY = 0;
});

function scrollTo(y: number) {
  act(() => {
    window.scrollY = y;
    window.dispatchEvent(new Event("scroll"));
  });
}

it("collapses while scrolling down and expands on reversal or settle", () => {
  const { result } = renderHook(() => useCollapseOnScroll());
  expect(result.current).toBe(false);

  scrollTo(40);
  expect(result.current).toBe(false); // still near the top
  scrollTo(200);
  expect(result.current).toBe(true);
  scrollTo(204);
  expect(result.current).toBe(true); // jitter keeps the current state
  scrollTo(150);
  expect(result.current).toBe(false);

  scrollTo(400);
  expect(result.current).toBe(true);
  act(() => {
    vi.advanceTimersByTime(600);
  });
  expect(result.current).toBe(false);
});

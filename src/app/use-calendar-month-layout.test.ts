import { cleanup, renderHook } from "../test/render";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  monthDotCapacity,
  useCalendarMonthLayout,
} from "./use-calendar-month-layout";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("monthDotCapacity", () => {
  it("reserves the full count before fitting six-pixel dots and two-pixel gaps", () => {
    expect(monthDotCapacity(46, 20)).toBe(3);
    expect(monthDotCapacity(46, 28)).toBe(2);
    expect(monthDotCapacity(38, 28)).toBe(1);
  });
});

it("measures again when the calendar redraws, not when a preview adds its own button", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const root = document.createElement("div");
  root.innerHTML =
    '<div class="tnc-dg-week"><div class="tnc-dg-dots"></div></div>';
  const measured = vi.spyOn(root, "querySelectorAll");
  renderHook(() => useCalendarMonthLayout({ current: root }, true, 3));
  const settled = () => new Promise((resolve) => setTimeout(resolve));
  await settled();
  const before = measured.mock.calls.length;
  expect(before).toBeGreaterThan(0);

  // Measuring here would answer the preview, which would redraw its buttons.
  const more = document.createElement("button");
  more.className = "tnc-more tnc-preview-more";
  root.firstElementChild!.append(more);
  await settled();
  expect(measured).toHaveBeenCalledTimes(before);
  // Its own measuring node leaves no trace either.
  expect(root.querySelector(".tnc-month-measure")).toBeNull();

  root.append(document.createElement("div"));
  await settled();
  expect(measured.mock.calls.length).toBeGreaterThan(before);
});

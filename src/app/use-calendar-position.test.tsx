import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCalendarPosition } from "./use-calendar-position";

afterEach(() => vi.restoreAllMocks());

function fixture(html: string) {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  const root = document.createElement("div");
  root.innerHTML = html;
  return { current: root };
}

function bounds(
  element: Element,
  left: number,
  top: number,
  width: number,
  height: number,
) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
    new DOMRect(left, top, width, height),
  );
}

it("reveals the phone week's selected day with an adjacent-column hint", () => {
  const root = fixture(
    '<div class="tnc-tg-scroll"><div class="tnc-gutter-head"></div><div class="tnc-dh" data-date="2026-11-05"></div></div>',
  );
  const scroller = root.current.firstElementChild as HTMLElement;
  bounds(scroller, 20, 100, 372, 400);
  bounds(root.current.querySelector(".tnc-gutter-head")!, 20, 100, 44, 40);
  bounds(root.current.querySelector(".tnc-dh")!, 704, 100, 160, 40);
  scroller.scrollTop = 176;
  renderHook(() =>
    useCalendarPosition(root, "timeGridWeek", true, "2026-11-05", 0),
  );
  expect(scroller.scrollLeft).toBe(616);
  expect(scroller.scrollTop).toBe(176);
});

it("restores later week browsing rather than recentering on selection or mode changes", async () => {
  const root = fixture(
    '<div class="tnc-tg-scroll"><div class="tnc-dh" data-date="2026-11-05"></div></div>',
  );
  const scroller = root.current.firstElementChild as HTMLElement;
  const view = renderHook(
    ({ mode, selected }) => useCalendarPosition(root, mode, true, selected, 0),
    {
      initialProps: { mode: "timeGridWeek", selected: "2026-11-05" },
    },
  );
  scroller.scrollLeft = 320;
  scroller.scrollTop = 270;
  await act(() => scroller.dispatchEvent(new Event("scroll")));
  view.rerender({ mode: "timeGridDay", selected: "2026-11-05" });
  scroller.scrollLeft = 0;
  scroller.scrollTop = 0;
  view.rerender({ mode: "timeGridWeek", selected: "2026-11-06" });
  expect(scroller.scrollLeft).toBe(320);
  expect(scroller.scrollTop).toBe(270);
});

it("reveals the selected month with nearest alignment and preserves subsequent year browsing", async () => {
  const root = fixture(
    '<div class="tnc-year-scroll"><section class="tnc-ym"><button class="tnc-ym-day" data-date="2026-11-05"></button></section></div>',
  );
  const scroller = root.current.firstElementChild as HTMLElement;
  bounds(scroller, 0, 100, 400, 400);
  bounds(root.current.querySelector(".tnc-ym")!, 0, 900, 400, 300);
  const view = renderHook(
    ({ selected }) =>
      useCalendarPosition(root, "multiMonthYear", true, selected, 0),
    {
      initialProps: { selected: "2026-11-05" },
    },
  );
  expect(scroller.scrollTop).toBe(700);
  scroller.scrollTop = 100;
  await act(() => scroller.dispatchEvent(new Event("scroll")));
  view.rerender({ selected: "2026-11-06" });
  expect(scroller.scrollTop).toBe(100);
});

it("does not overwrite a saved position with a detached calendar's zero offset", async () => {
  const root = fixture('<div class="tnc-year-scroll"></div>');
  const scroller = root.current.firstElementChild as HTMLElement;
  const view = renderHook(
    ({ mode }) => useCalendarPosition(root, mode, true, "2026-11-05", 0),
    {
      initialProps: { mode: "multiMonthYear" },
    },
  );
  scroller.scrollTop = 100;
  await act(() => scroller.dispatchEvent(new Event("scroll")));
  scroller.remove();
  scroller.scrollTop = 0;
  view.rerender({ mode: "dayGridMonth" });
  const replacement = document.createElement("div");
  replacement.className = "tnc-year-scroll";
  root.current.append(replacement);
  view.rerender({ mode: "multiMonthYear" });
  expect(replacement.scrollTop).toBe(100);
});

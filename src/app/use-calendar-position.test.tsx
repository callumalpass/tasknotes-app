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

it("reveals the phone week's selected day fully beside the gutter", () => {
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
  expect(scroller.scrollLeft).toBe(640);
  expect(scroller.scrollTop).toBe(176);
});

it("preserves intentional scrolling within a layout", async () => {
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
  view.rerender({ mode: "timeGridWeek", selected: "2026-11-06" });
  expect(scroller.scrollLeft).toBe(320);
  expect(scroller.scrollTop).toBe(270);
});

it("aligns the selected month's heading and preserves subsequent year browsing", async () => {
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
  expect(scroller.scrollTop).toBe(800);
  scroller.scrollTop = 100;
  await act(() => scroller.dispatchEvent(new Event("scroll")));
  view.rerender({ selected: "2026-11-06" });
  expect(scroller.scrollTop).toBe(100);
});

it.each(["timeGridDay", "dayGridMonth"])(
  "reveals the active column when returning from %s to a previously scrolled layout",
  async (mode) => {
    const root = fixture(
      '<div class="tnc-tg-scroll"><div class="tnc-gutter-head"></div><div class="tnc-dh" data-date="2026-11-05"></div></div>',
    );
    const scroller = root.current.firstElementChild as HTMLElement;
    bounds(scroller, 20, 100, 372, 400);
    bounds(root.current.querySelector(".tnc-gutter-head")!, 20, 100, 44, 40);
    const target = root.current.querySelector(".tnc-dh")!;
    bounds(target, 64, 100, 160, 40);
    const view = renderHook(
      ({ mode }) => useCalendarPosition(root, mode, true, "2026-11-05", 0),
      { initialProps: { mode: "timeGridWeek" } },
    );
    scroller.scrollLeft = 320;
    await act(() => scroller.dispatchEvent(new Event("scroll")));
    view.rerender({ mode });
    bounds(target, 384, 100, 160, 40);
    view.rerender({ mode: "timeGridWeek" });
    expect(scroller.scrollLeft).toBe(640);
  },
);

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

it("resets only outer scrolling on layout changes while retaining the selected day", () => {
  const root = fixture(
    '<div class="tnc-tg-scroll"><div class="tnc-gutter-head"></div><div class="tnc-dh" data-date="2026-11-06"></div></div>',
  );
  const outer = document.createElement("main");
  outer.append(root.current);
  outer.scrollTop = 1742;
  const scroller = root.current.firstElementChild as HTMLElement;
  bounds(scroller, 0, 100, 372, 400);
  bounds(root.current.querySelector(".tnc-gutter-head")!, 0, 100, 44, 40);
  bounds(root.current.querySelector(".tnc-dh")!, 844, 100, 160, 40);
  const view = renderHook(
    ({ mode }) => useCalendarPosition(root, mode, true, "2026-11-06", 0),
    { initialProps: { mode: "listWeek" } },
  );
  expect(outer.scrollTop).toBe(1742);
  view.rerender({ mode: "timeGridWeek" });
  expect(outer.scrollTop).toBe(0);
  expect(scroller.scrollLeft).toBe(800);
  outer.scrollTop = 100;
  view.rerender({ mode: "timeGridWeek" });
  expect(outer.scrollTop).toBe(100);
});

it("shows the trailing cue only while additional day columns remain", async () => {
  const root = fixture('<div class="tnc-tg-scroll"></div>');
  const scroller = root.current.firstElementChild as HTMLElement;
  Object.defineProperties(scroller, {
    scrollWidth: { value: 1164 },
    clientWidth: { value: 372 },
  });
  renderHook(() =>
    useCalendarPosition(root, "timeGridWeek", true, "2026-11-05", 0),
  );
  expect(root.current.dataset.moreDays).toBe("true");
  scroller.scrollLeft = 792;
  await act(() => scroller.dispatchEvent(new Event("scroll")));
  expect(root.current.dataset.moreDays).toBe("false");
});

it("keeps the selected month heading below an overlapping toolbar", () => {
  const root = fixture(
    '<div class="full-calendar-commandbar"></div><div class="tnc-year-scroll"><section class="tnc-ym"><button class="tnc-ym-day" data-date="2026-11-05"></button></section></div>',
  );
  const scroller = root.current.querySelector<HTMLElement>(".tnc-year-scroll")!;
  bounds(scroller, 0, 80, 800, 400);
  bounds(
    root.current.querySelector(".full-calendar-commandbar")!,
    0,
    60,
    800,
    60,
  );
  bounds(root.current.querySelector(".tnc-ym")!, 0, 900, 240, 200);
  Object.defineProperty(scroller, "clientHeight", { value: 400 });
  renderHook(() =>
    useCalendarPosition(root, "multiMonthYear", false, "2026-11-05", 0),
  );
  expect(scroller.scrollTop).toBe(780);
  expect(scroller.style.paddingBottom).toBe("200px");
});

it("names the visible phone week columns and updates the cue after scrolling", async () => {
  const root = fixture(
    '<div class="tnc-tg-scroll"><div class="tnc-gutter-head"></div><div class="tnc-dh" data-date="2026-11-05"></div><div class="tnc-dh" data-date="2026-11-06"></div><div class="tnc-dh" data-date="2026-11-07"></div></div>',
  );
  const scroller = root.current.firstElementChild as HTMLElement;
  bounds(scroller, 0, 80, 360, 400);
  bounds(root.current.querySelector(".tnc-gutter-head")!, 0, 80, 44, 40);
  const days = root.current.querySelectorAll(".tnc-dh");
  bounds(days[0], 44, 80, 160, 40);
  bounds(days[1], 204, 80, 160, 40);
  bounds(days[2], 364, 80, 160, 40);
  const view = renderHook(() =>
    useCalendarPosition(root, "timeGridWeek", true, "2026-11-05", 0),
  );
  expect(view.result.current).toContain("Nov");
  expect(view.result.current).toContain("5");
  expect(view.result.current).toContain("6");
  bounds(days[0], -116, 80, 160, 40);
  bounds(days[1], 44, 80, 160, 40);
  bounds(days[2], 204, 80, 160, 40);
  await act(() => scroller.dispatchEvent(new Event("scroll")));
  expect(view.result.current).not.toContain("5");
  expect(view.result.current).toContain("7");
});

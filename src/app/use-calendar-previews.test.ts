import { cleanup, renderHook } from "../test/render";
import { afterEach, expect, it, vi } from "vitest";
import {
  boundCalendarPreviews,
  useCalendarPreviews,
} from "./use-calendar-previews";

afterEach(cleanup);

it.each(["all-day", "month"])(
  "bounds exactly three %s events to two rows plus day details",
  (kind) => {
    const root = document.createElement("div");
    const allDay = kind === "all-day";
    root.innerHTML = `<div class="${allDay ? "tnc-tg-top" : "tnc-dg-week"}">
    <div class="${allDay ? "tnc-dh" : "tnc-dg-day"}" data-date="2026-11-05"></div>
    <div class="${allDay ? "tnc-allday-layer" : "tnc-dg-content"}">
      <div class="tnc-more-layer"></div>
      ${[0, 1, 2].map((level) => `<button class="tnc-item" style="top: calc(${allDay ? "" : "var(--tnc-dg-top-h) + "}${level} * (var(--tnc-bar-h) + 2px))">Task ${level}</button>`).join("")}
    </div>
  </div>`;
    const cell = root.querySelector("[data-date]")!;
    vi.spyOn(cell, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 44),
    );
    root.querySelectorAll(".tnc-item").forEach((item) => {
      vi.spyOn(item, "getBoundingClientRect").mockReturnValue(
        new DOMRect(2, 0, 96, 44),
      );
    });
    const inspect = vi.fn();
    boundCalendarPreviews(root, inspect, (count) => `+${count} more`);
    expect(
      root.querySelectorAll(".tnc-item:not(.tnc-preview-hidden)"),
    ).toHaveLength(2);
    expect(root.querySelector(".tnc-preview-hidden")).toHaveAttribute("inert");
    const more = root.querySelector<HTMLButtonElement>(".tnc-preview-more")!;
    expect(more.textContent).toBe("+1 more");
    more.click();
    expect(inspect).toHaveBeenCalledWith("2026-11-05");
  },
);

it("keeps overlapping timed tasks independently interactive in both lanes", () => {
  const root = document.createElement("div");
  root.innerHTML = `<div class="tnc-col" data-date="2026-11-07"><div class="tnc-col-plan">${[0, 1, 2].map((index) => `<div class="tnc-item--timed" style="top: ${index === 2 ? 200 : 100}px" aria-label="Task ${index}"></div>`).join("")}</div></div>`;
  root
    .querySelectorAll<HTMLElement>(".tnc-item--timed")
    .forEach((element, index) => {
      vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
        new DOMRect(index * 40, index === 2 ? 200 : 100, 40, 60),
      );
    });
  const actual = root
    .querySelector(".tnc-col-plan")!
    .cloneNode(true) as HTMLElement;
  actual.className = "tnc-col-actual";
  root.querySelector(".tnc-col")!.append(actual);
  renderHook(() => useCalendarPreviews({ current: root }, vi.fn()));
  expect(root.querySelectorAll(".tnc-item--timed")).toHaveLength(6);
  expect(root.querySelector("[inert]")).toBeNull();
  expect(root.querySelector(".calendar-collision-trigger")).toBeNull();
});

it("leaves Day's wrapping all-day cards and library overflow count intact", () => {
  const root = document.createElement("div");
  root.className = "is-day";
  root.innerHTML = `<div class="tnc-tg-top"><div class="tnc-dh" data-date="2026-11-05"></div><div class="tnc-allday-layer"><div class="tnc-more-layer"><button class="tnc-more">+4 more</button></div>${[0, 1, 2, 3, 4, 5].map((level) => `<button class="tnc-item" style="top: calc(${level} * 48px)">Task ${level}</button>`).join("")}</div></div>`;
  boundCalendarPreviews(root, vi.fn(), (count) => `+${count} more`);
  expect(
    root.querySelectorAll(".tnc-item:not(.tnc-preview-hidden)"),
  ).toHaveLength(6);
  expect(root.querySelector(".tnc-more")).toHaveTextContent("+4 more");
  expect(root.querySelector(".tnc-preview-more")).toBeNull();
});

it("does not redraw its previews for a month's measuring node, only for the calendar's own changes", async () => {
  const root = document.createElement("div");
  root.innerHTML = `<div class="tnc-dg-week">
    <div class="tnc-dg-day" data-date="2026-11-05"></div>
    <div class="tnc-dg-content">
      <div class="tnc-more-layer"></div>
      ${[0, 1, 2].map((level) => `<button class="tnc-item" style="top: calc(var(--tnc-dg-top-h) + ${level} * (var(--tnc-bar-h) + 2px))">Task ${level}</button>`).join("")}
    </div>
  </div>`;
  vi.spyOn(
    root.querySelector("[data-date]")!,
    "getBoundingClientRect",
  ).mockReturnValue(new DOMRect(0, 0, 100, 44));
  root.querySelectorAll(".tnc-item").forEach((item) => {
    vi.spyOn(item, "getBoundingClientRect").mockReturnValue(
      new DOMRect(2, 0, 96, 44),
    );
  });
  renderHook(() => useCalendarPreviews({ current: root }, vi.fn()));
  const more = root.querySelector(".tnc-preview-more");
  expect(more).not.toBeNull();
  const settled = () => new Promise((resolve) => setTimeout(resolve));

  // Redrawing here would answer the month layout, which would measure again.
  const measure = document.createElement("span");
  measure.className = "tnc-dg-dots-more tnc-month-measure";
  root.append(measure);
  measure.remove();
  await settled();
  expect(root.querySelector(".tnc-preview-more")).toBe(more);

  root.querySelector(".tnc-dg-content")!.append(document.createElement("i"));
  await settled();
  expect(root.querySelector(".tnc-preview-more")).not.toBe(more);
  expect(root.querySelectorAll(".tnc-preview-more")).toHaveLength(1);
});

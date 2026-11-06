import { expect, it, vi } from "vitest";
import {
  boundCalendarPreviews,
  boundCalendarCollisions,
} from "./use-calendar-previews";

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

it("replaces overlapping fragments with a keyboard-operable day expansion", () => {
  const root = document.createElement("div");
  root.innerHTML = `<div class="tnc-col" data-date="2026-11-07"><div class="tnc-col-plan">${[0, 1, 2].map((index) => `<div class="tnc-item--timed" style="top: ${index === 2 ? 200 : 100}px" aria-label="Task ${index}"></div>`).join("")}</div></div>`;
  root
    .querySelectorAll<HTMLElement>(".tnc-item--timed")
    .forEach((element, index) => {
      vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
        new DOMRect(index * 40, index === 2 ? 200 : 100, 40, 60),
      );
    });
  const inspect = vi.fn();
  boundCalendarCollisions(root, inspect, (count) => `${count} tasks`);
  expect(root.querySelectorAll(".tnc-collision-hidden[inert]")).toHaveLength(2);
  const trigger = root.querySelector<HTMLButtonElement>(
    ".calendar-collision-trigger",
  )!;
  expect(trigger).toHaveTextContent("2 tasks");
  expect(trigger.type).toBe("button");
  boundCalendarCollisions(root, inspect, (count) => `${count} tasks`);
  expect(root.querySelector(".calendar-collision-trigger")).toBe(trigger);
  trigger.click();
  expect(inspect).toHaveBeenCalledWith("2026-11-07");
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

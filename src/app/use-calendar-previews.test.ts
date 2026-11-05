import { expect, it, vi } from "vitest";
import { boundCalendarPreviews } from "./use-calendar-previews";

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

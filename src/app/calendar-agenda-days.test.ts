import { afterEach, expect, it, vi } from "vitest";
import { compactAgendaDays } from "./calendar-agenda-days";

afterEach(() => vi.useRealTimers());

it("collapses empty runs while keeping today, selection and busy event days", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T12:00:00"));
  const root = document.createElement("div");
  root.innerHTML = [7, 8, 9, 10, 11, 12, 13]
    .map(
      (day) =>
        `<section class="tnc-list-section${day === 11 ? "" : " is-empty"}" data-date="2026-11-${String(day).padStart(2, "0")}"><h2 class="tnc-list-day">Day ${day}</h2><button class="tnc-list-add">Add task</button>${day === 11 ? '<div class="google-calendar-event">Meeting</div>' : ""}</section>`,
    )
    .join("");
  compactAgendaDays(root, "2026-11-10", "en");
  expect(root.querySelectorAll(".is-empty-range")).toHaveLength(2);
  expect(root.querySelectorAll("[hidden]")).toHaveLength(2);
  expect(root.querySelector('[data-date="2026-11-07"]')).not.toHaveAttribute(
    "hidden",
  );
  expect(root.querySelector('[data-date="2026-11-10"]')).not.toHaveClass(
    "is-empty-range",
  );
  expect(root.querySelector('[data-date="2026-11-11"]')).not.toHaveAttribute(
    "hidden",
  );
  compactAgendaDays(root, "2026-11-09", "en");
  expect(root.querySelectorAll(".is-add-day")).toHaveLength(2);
  expect(root.querySelector('[data-date="2026-11-07"]')).toHaveClass(
    "is-add-day",
  );
  expect(root.querySelector('[data-date="2026-11-09"]')).toHaveClass(
    "is-add-day",
  );
  expect(root.querySelector('[data-date="2026-11-10"]')).not.toHaveClass(
    "is-add-day",
  );
  expect(root.querySelector('[data-date="2026-11-11"]')).not.toHaveClass(
    "is-add-day",
  );
  expect(root.querySelector('[data-date="2026-11-09"]')).not.toHaveAttribute(
    "hidden",
  );
  expect(root.querySelector('[data-date="2026-11-09"]')).not.toHaveClass(
    "is-empty-range",
  );
  expect(root.querySelector('[data-date="2026-11-10"]')).toHaveClass(
    "is-empty-range",
  );
});

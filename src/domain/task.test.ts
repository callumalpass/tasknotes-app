import { describe, expect, it } from "vitest";

import {
  formatRelativeTaskDate,
  combineTaskDateTime,
  dateFromStorage,
  isTaskDateOverdue,
  normalizeTaskDateTime,
  taskDatePart,
  taskTimePart,
} from "./task";

describe("task dates", () => {
  it("round-trips date-only and local datetime values", () => {
    expect(combineTaskDateTime("2026-08-05", "09:30")).toBe("2026-08-05T09:30");
    expect(taskDatePart("2026-08-05T09:30")).toBe("2026-08-05");
    expect(taskTimePart("2026-08-05T09:30")).toBe("09:30");
    expect(dateFromStorage("2026-08-05T09:30")).toBeInstanceOf(Date);
  });

  it("normalizes local datetime input to canonical UTC second precision", () => {
    const normalized = normalizeTaskDateTime("2026-08-05T09:30");
    expect(normalized).toMatch(/^2026-08-0[45]T\d{2}:30:00Z$/);
    expect(taskDatePart(normalized)).toBe("2026-08-05");
    expect(taskTimePart(normalized)).toBe("09:30");
  });

  it("compares timed tasks against the current moment", () => {
    const now = new Date(2026, 7, 5, 10, 0);
    expect(isTaskDateOverdue("2026-08-05T09:30", now)).toBe(true);
    expect(isTaskDateOverdue("2026-08-05T10:30", now)).toBe(false);
    expect(isTaskDateOverdue("2026-08-05", now)).toBe(false);
    expect(isTaskDateOverdue("2026-08-04", now)).toBe(true);
  });
});

describe("formatRelativeTaskDate", () => {
  const today = "2026-09-24";
  it.each([
    ["2026-09-24", "Today"],
    ["2026-09-23", "Yesterday"],
    ["2026-09-21", "3 days ago"],
    ["2026-09-25", "Tomorrow"],
  ])("labels %s relative to today", (value, label) => {
    expect(formatRelativeTaskDate(value, today)).toBe(label);
  });

  it("keeps upcoming times, drops past ones, and uses short dates beyond a week", () => {
    expect(formatRelativeTaskDate("2026-09-25T09:00", today)).toMatch(
      /^Tomorrow, 9:00/,
    );
    expect(formatRelativeTaskDate("2026-09-23T09:00", today)).toBe("Yesterday");
    expect(formatRelativeTaskDate("2026-08-01", today)).not.toMatch(/ago|day/);
  });
});

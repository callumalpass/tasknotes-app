import { describe, expect, it } from "vitest";

import {
  formatRelativeTaskDate,
  combineTaskDateTime,
  dateFromStorage,
  isTaskDateOverdue,
  normalizeTaskDateTime,
  taskDatePart,
  taskTimePart,
  todayString,
} from "./task";

describe("task dates", () => {
  it("round-trips date-only and local datetime values", () => {
    expect(combineTaskDateTime("2026-08-05", "09:30")).toBe("2026-08-05T09:30");
    expect(taskDatePart("2026-08-05T09:30")).toBe("2026-08-05");
    expect(taskTimePart("2026-08-05T09:30")).toBe("09:30");
    expect(dateFromStorage("2026-08-05T09:30")).toBeInstanceOf(Date);
  });

  it("keeps date-only and local input and maps explicit offsets to the collection wall clock", () => {
    const zone = "America/New_York";
    expect(normalizeTaskDateTime("2026-08-05", zone)).toBe("2026-08-05");
    expect(normalizeTaskDateTime("2026-08-05T09:30", zone)).toBe(
      "2026-08-05T09:30",
    );
    expect(normalizeTaskDateTime("2026-08-05T01:30:42Z", zone)).toBe(
      "2026-08-04T21:30:42",
    );
    expect(taskDatePart("2026-08-05T01:30:42Z", zone)).toBe("2026-08-04");
    expect(taskTimePart("2026-08-05T01:30:42Z", zone)).toBe("21:30");
    expect(todayString(new Date("2026-08-05T01:00Z"), zone)).toBe("2026-08-04");
  });

  it("uses the earlier overlap and moves a gap forward in the collection zone", () => {
    const zone = "America/New_York";
    expect(dateFromStorage("2026-11-01T01:30", zone)?.toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
    expect(dateFromStorage("2026-03-08T02:30", zone)?.toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
    expect(
      isTaskDateOverdue(
        "2026-11-01T01:30",
        new Date("2026-11-01T06:00Z"),
        zone,
      ),
    ).toBe(true);
    expect(
      isTaskDateOverdue(
        "2026-11-01T01:30-05:00",
        new Date("2026-11-01T06:00Z"),
        zone,
      ),
    ).toBe(false);
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

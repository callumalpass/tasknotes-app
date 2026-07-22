import { describe, expect, it } from "vitest";

import {
  combineTaskDateTime,
  dateFromStorage,
  isTaskDateOverdue,
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

  it("compares timed tasks against the current moment", () => {
    const now = new Date(2026, 7, 5, 10, 0);
    expect(isTaskDateOverdue("2026-08-05T09:30", now)).toBe(true);
    expect(isTaskDateOverdue("2026-08-05T10:30", now)).toBe(false);
    expect(isTaskDateOverdue("2026-08-05", now)).toBe(false);
    expect(isTaskDateOverdue("2026-08-04", now)).toBe(true);
  });
});

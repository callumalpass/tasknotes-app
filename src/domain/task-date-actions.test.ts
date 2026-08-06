import { describe, expect, it } from "vitest";

import { taskDatePart, taskTimePart } from "./task";
import { shiftTaskDate } from "./task-date-actions";

describe("shiftTaskDate", () => {
  it("moves dates across month and year boundaries", () => {
    expect(shiftTaskDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftTaskDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("preserves displayed wall time when moving an instant", () => {
    const value = "2026-07-26T09:30:00+10:00";
    const shifted = shiftTaskDate(value, 1);
    expect(taskDatePart(shifted)).toBe(shiftTaskDate(taskDatePart(value), 1));
    expect(taskTimePart(shifted)).toBe(taskTimePart(value));
  });

  it("preserves displayed wall time across a local DST boundary", () => {
    const value = "2026-03-07T17:30:00Z";
    const shifted = shiftTaskDate(value, 1);
    expect(taskDatePart(shifted)).toBe(shiftTaskDate(taskDatePart(value), 1));
    expect(taskTimePart(shifted)).toBe(taskTimePart(value));
  });

  it("leaves invalid or nonportable values unchanged", () => {
    expect(shiftTaskDate("2026-02-30", 1)).toBe("2026-02-30");
    expect(shiftTaskDate("tomorrow", 1)).toBe("tomorrow");
  });
});

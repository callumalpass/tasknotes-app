import { describe, expect, it } from "vitest";

import { taskDatePart, taskTimePart } from "./task";
import { rescheduleInput, shiftTaskDate } from "./task-date-actions";

describe("shiftTaskDate", () => {
  it("moves dates across month and year boundaries", () => {
    expect(shiftTaskDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftTaskDate("2026-03-01", -1)).toBe("2026-02-28");
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

describe("rescheduleInput", () => {
  it("moves a missed deadline with the plan, keeping times", () => {
    expect(
      rescheduleInput(
        { scheduled: "2026-07-20T09:30", due: "2026-07-22T17:00" },
        "2026-07-27",
        "2026-07-26",
      ),
    ).toEqual({ scheduled: "2026-07-27T09:30", due: "2026-07-27T17:00" });
  });

  it("leaves a future deadline alone", () => {
    expect(
      rescheduleInput(
        { scheduled: "2026-07-20", due: "2026-07-30" },
        "2026-07-27",
        "2026-07-26",
      ),
    ).toEqual({ scheduled: "2026-07-27" });
  });
});

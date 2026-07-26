import { describe, expect, it } from "vitest";

import { shiftTaskDate } from "./task-date-actions";

describe("shiftTaskDate", () => {
  it("moves dates across month and year boundaries", () => {
    expect(shiftTaskDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftTaskDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("preserves datetime and timezone suffixes", () => {
    expect(shiftTaskDate("2026-07-26T09:30:00+10:00", 1)).toBe(
      "2026-07-27T09:30:00+10:00",
    );
  });

  it("leaves invalid or nonportable values unchanged", () => {
    expect(shiftTaskDate("2026-02-30", 1)).toBe("2026-02-30");
    expect(shiftTaskDate("tomorrow", 1)).toBe("tomorrow");
  });
});

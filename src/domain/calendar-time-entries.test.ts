import { describe, expect, it } from "vitest";

import {
  moveCalendarTimeEntry,
  resizeCalendarTimeEntry,
} from "./calendar-time-entries";

describe("calendar time-entry changes", () => {
  const entries = [
    {
      startTime: "2026-08-16T01:00:00.000Z",
      endTime: "2026-08-16T02:00:00.000Z",
      description: "Build calendar",
    },
  ];

  it("moves a closed entry without changing its duration or description", () => {
    expect(
      moveCalendarTimeEntry(
        entries,
        0,
        new Date("2026-08-17T03:00:00.000Z"),
        new Date("2026-08-17T04:00:00.000Z"),
      ),
    ).toEqual([
      {
        startTime: "2026-08-17T03:00:00.000Z",
        endTime: "2026-08-17T04:00:00.000Z",
        description: "Build calendar",
      },
    ]);
    expect(entries[0].startTime).toBe("2026-08-16T01:00:00.000Z");
  });

  it("resizes the selected entry", () => {
    expect(
      resizeCalendarTimeEntry(
        entries,
        0,
        new Date("2026-08-16T02:30:00.000Z"),
      )[0].endTime,
    ).toBe("2026-08-16T02:30:00.000Z");
  });
});

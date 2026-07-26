import { describe, expect, it } from "vitest";

import {
  editableReminderOffset,
  reminderFireTime,
  reminderOffset,
} from "./reminder";

describe("task reminders", () => {
  it("round-trips the editable relative reminder presets", () => {
    expect(
      reminderOffset({ amount: 15, unit: "minutes", direction: "before" }),
    ).toBe("-PT15M");
    expect(editableReminderOffset("PT2H")).toEqual({
      amount: 2,
      unit: "hours",
      direction: "after",
    });
    expect(editableReminderOffset("-P1D")).toEqual({
      amount: 1,
      unit: "days",
      direction: "before",
    });
  });

  it("resolves relative reminders against due and scheduled task times", () => {
    expect(
      reminderFireTime(
        {
          scheduled: "2026-08-05T09:00:00+10:00",
          due: "2026-08-06T17:00:00+10:00",
        },
        {
          id: "scheduled",
          type: "relative",
          relatedTo: "scheduled",
          offset: "-PT15M",
        },
      ),
    ).toBe("2026-08-04T22:45:00.000Z");
    expect(
      reminderFireTime(
        { due: "2026-08-06T17:00:00+10:00" },
        {
          id: "due",
          type: "relative",
          relatedTo: "due",
          offset: "PT2H",
        },
      ),
    ).toBe("2026-08-06T09:00:00.000Z");
  });

  it("ignores relative reminders without a valid anchor or duration", () => {
    expect(
      reminderFireTime(
        {},
        {
          id: "missing",
          type: "relative",
          relatedTo: "due",
          offset: "-PT15M",
        },
      ),
    ).toBeUndefined();
    expect(
      reminderFireTime(
        { due: "2026-08-06" },
        {
          id: "invalid",
          type: "relative",
          relatedTo: "due",
          offset: "tomorrow",
        },
      ),
    ).toBeUndefined();
  });
});

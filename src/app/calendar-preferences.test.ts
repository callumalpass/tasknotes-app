import { describe, expect, it } from "vitest";

import {
  calendarMonthGrid,
  defaultCalendarPreferences,
  loadCalendarPreferences,
  orderedWeekdays,
  saveCalendarPreferences,
  startOfCalendarWeek,
} from "./calendar-preferences";

describe("calendar preferences", () => {
  it("uses locale week information when available", () => {
    expect(defaultCalendarPreferences("en-US").firstDay).toBe(0);
    expect(defaultCalendarPreferences("en-AU").firstDay).toBe(1);
  });

  it("round trips valid device preferences", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const preference = {
      ...defaultCalendarPreferences("en-AU"),
      firstDay: 6,
      weekends: false,
      hourFormat: "24" as const,
      slotDuration: "00:15:00",
    };
    saveCalendarPreferences(preference, storage);
    expect(loadCalendarPreferences(storage, "en-US")).toEqual(preference);
  });

  it("rejects malformed persisted values", () => {
    const storage = {
      getItem: () =>
        JSON.stringify({ firstDay: 9, weekends: "yes", slotMinTime: "later" }),
    };
    expect(loadCalendarPreferences(storage, "en-AU")).toEqual(
      defaultCalendarPreferences("en-AU"),
    );
  });

  it("orders labels and week boundaries from the selected first day", () => {
    expect(orderedWeekdays(1, "en-AU", "short")[0]).toBe("Mon");
    expect(startOfCalendarWeek(new Date(2026, 7, 16), 1).getDay()).toBe(1);
    expect(startOfCalendarWeek(new Date(2026, 7, 16), 6).getDay()).toBe(6);
    expect(calendarMonthGrid(new Date(2026, 7, 1), 1)[0].getDay()).toBe(1);
    expect(calendarMonthGrid(new Date(2026, 7, 1), 0)[0].getDay()).toBe(0);
  });
});

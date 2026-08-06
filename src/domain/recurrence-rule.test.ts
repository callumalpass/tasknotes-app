import { describe, expect, it } from "vitest";

import {
  buildRecurrenceRule,
  parseRecurrenceRule,
  recurrenceDtstartValue,
  recurrencePreset,
  recurrenceRuleForPreset,
  recurrenceRuleSummary,
  recurrenceStartStorageValue,
} from "./recurrence-rule";
import { taskDatePart, taskTimePart } from "./task";

describe("recurrence rules", () => {
  it("round-trips weekly intervals, weekdays, and a count", () => {
    const rule =
      "DTSTART:20260803;FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=12";
    expect(buildRecurrenceRule(parseRecurrenceRule(rule))).toBe(rule);
  });

  it("round-trips an until date and preserves DTSTART", () => {
    const rule =
      "DTSTART:20260803T090000Z;FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=3;UNTIL=20270131T235959Z";
    expect(buildRecurrenceRule(parseRecurrenceRule(rule))).toBe(rule);
  });

  it("preserves weekday-only daily rules when visually edited", () => {
    const rule = "DTSTART:20260803;FREQ=DAILY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR";
    const parsed = parseRecurrenceRule(rule);
    expect(parsed.unsupported).toEqual([]);
    expect(buildRecurrenceRule({ ...parsed, count: 6, end: "count" })).toBe(
      `${rule};COUNT=6`,
    );
    expect(recurrencePreset(rule)).toBe("weekdays");
  });

  it.each([
    [
      "monthly last day",
      "DTSTART:20260831;FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1",
      "Every month on the last day",
    ],
    [
      "monthly ordinal weekday",
      "DTSTART:20260801;FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR",
      "Every month on the last Friday",
    ],
    [
      "yearly date",
      "DTSTART:20260812;FREQ=YEARLY;INTERVAL=1;BYMONTHDAY=12;BYMONTH=8",
      "Every year on the 12th of August",
    ],
    [
      "yearly ordinal weekday",
      "DTSTART:20260801;FREQ=YEARLY;INTERVAL=1;BYMONTH=8;BYDAY=2TU",
      "Every year on the second Tuesday of August",
    ],
  ])("round-trips a %s rule", (_, rule, summary) => {
    const parsed = parseRecurrenceRule(rule);
    expect(parsed.unsupported).toEqual([]);
    expect(parsed.invalid).toEqual([]);
    expect(buildRecurrenceRule(parsed)).toBe(rule);
    expect(recurrenceRuleSummary(parsed)).toBe(summary);
  });

  it("understands BYSETPOS rules and writes the equivalent ordinal form", () => {
    const parsed = parseRecurrenceRule(
      "DTSTART:20260801;FREQ=MONTHLY;BYDAY=MO;BYSETPOS=2",
    );
    expect(parsed.unsupported).toEqual([]);
    expect(parsed.pattern).toBe("weekday");
    expect(parsed.position).toBe(2);
    expect(parsed.weekdays).toEqual(["MO"]);
    expect(buildRecurrenceRule(parsed)).toBe(
      "DTSTART:20260801;FREQ=MONTHLY;INTERVAL=1;BYDAY=2MO",
    );
  });

  it("reports clauses the visual editor cannot safely rewrite", () => {
    const parsed = parseRecurrenceRule(
      "DTSTART:20260803;FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=2;BYHOUR=9",
    );
    expect(parsed.unsupported).toEqual(
      expect.arrayContaining(["BYDAY", "BYHOUR"]),
    );
    expect(parsed.invalid).toEqual([]);
  });

  it("reports malformed and contradictory rules separately", () => {
    const parsed = parseRecurrenceRule(
      "DTSTART:20260230;FREQ=MONTHLY;COUNT=3;UNTIL=20261201",
    );
    expect(parsed.invalid).toEqual([
      "DTSTART must be a date or UTC date and time.",
      "Use either an occurrence count or an end date, not both.",
    ]);
  });

  it("accepts an iCalendar-style RRULE prefix and newline", () => {
    const parsed = parseRecurrenceRule(
      "DTSTART:20260803T090000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO",
    );
    expect(parsed.invalid).toEqual([]);
    expect(buildRecurrenceRule(parsed)).toBe(
      "DTSTART:20260803T090000Z;FREQ=WEEKLY;INTERVAL=1;BYDAY=MO",
    );
  });

  it("creates complete presets from the scheduled date and time", () => {
    expect(
      recurrenceRuleForPreset("weekly", {
        scheduled: "2026-08-05T09:30",
      }),
    ).toBe("DTSTART:20260805T093000Z;FREQ=WEEKLY;INTERVAL=1;BYDAY=WE");
    expect(
      recurrenceRuleForPreset("monthly", {
        scheduled: "2026-08-31",
      }),
    ).toBe("DTSTART:20260831;FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31");
    expect(
      recurrenceRuleForPreset("yearly", {
        scheduled: "2026-08-31",
      }),
    ).toBe("DTSTART:20260831;FREQ=YEARLY;INTERVAL=1;BYMONTHDAY=31;BYMONTH=8");
  });

  it("derives DTSTART from the displayed day and time of a stored instant", () => {
    const scheduled = "2026-08-05T23:30:00Z";
    const date = taskDatePart(scheduled).replaceAll("-", "");
    const time = taskTimePart(scheduled).replace(":", "");
    expect(recurrenceDtstartValue(scheduled)).toBe(`${date}T${time}00Z`);
  });

  it("converts between TaskNotes DTSTART and task field storage", () => {
    expect(recurrenceStartStorageValue("20260803")).toBe("2026-08-03");
    expect(recurrenceStartStorageValue("20260803T091500Z")).toBe(
      "2026-08-03T09:15",
    );
    expect(recurrenceDtstartValue("2026-08-03")).toBe("20260803");
    expect(recurrenceDtstartValue("2026-08-03T09:15")).toBe("20260803T091500Z");
  });
});

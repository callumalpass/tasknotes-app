import { describe, expect, it } from "vitest";

import { buildRecurrenceRule, parseRecurrenceRule } from "./recurrence-rule";

describe("recurrence rules", () => {
  it("round-trips weekly intervals, weekdays, and a count", () => {
    const rule = "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=12";
    expect(buildRecurrenceRule(parseRecurrenceRule(rule))).toBe(rule);
  });

  it("round-trips an until date and preserves DTSTART", () => {
    const rule =
      "DTSTART:20260803T000000Z;FREQ=MONTHLY;INTERVAL=1;UNTIL=20270131T235959Z";
    expect(buildRecurrenceRule(parseRecurrenceRule(rule))).toBe(rule);
  });

  it("reports clauses the visual editor cannot safely rewrite", () => {
    expect(
      parseRecurrenceRule("FREQ=MONTHLY;BYDAY=MO;BYSETPOS=2").unsupported,
    ).toEqual(["BYSETPOS"]);
  });
});

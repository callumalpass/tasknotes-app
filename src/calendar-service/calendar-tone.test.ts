import { describe, expect, it } from "vitest";
import { calendarTone } from "./calendar-tone";

describe("calendar tones", () => {
  it("keeps Google's hue at the app's own lightness and restraint", () => {
    // Google's "Peacock" and "Tomato".
    expect(calendarTone("#039be5", 0)).toMatch(
      /^oklch\(55% 0\.1[0-4]\d? 2[34]\d\)$/,
    );
    expect(calendarTone("#D50000", 0)).toMatch(/^oklch\(55% 0\.140 2\d\)$/);
  });

  it("leaves a grey calendar grey", () => {
    expect(calendarTone("#616161", 3)).toMatch(/^oklch\(55% 0\.000 \d+\)$/);
  });

  it("takes a tone by position when Google gives no usable colour", () => {
    expect(calendarTone(null, 1)).toBe("var(--google-calendar-tone-1)");
    expect(calendarTone(undefined, 7)).toBe("var(--google-calendar-tone-1)");
    expect(calendarTone("teal", 2)).toBe("var(--google-calendar-tone-2)");
    expect(calendarTone("#0088aa; color: red", 2)).toBe(
      "var(--google-calendar-tone-2)",
    );
  });
});

import { describe, expect, it } from "vitest";
import { nativeCellValue } from "./next-bases-values";

describe("native cell projection (synthetic codec values only)", () => {
  it("keeps null separate from explicit error and unavailable cells", () => {
    expect(nativeCellValue({ kind: "null" })).toBeNull();
    expect(nativeCellValue({ kind: "error", message: "date error" })).toEqual({
      kind: "error",
      message: "date error",
    });
    expect(
      nativeCellValue({ kind: "unavailable", code: "size", detail: "no stat" }),
    ).toEqual({ kind: "unavailable", code: "size", detail: "no stat" });
  });
  it("retains authoritative temporal provenance and native display without date inference", () => {
    const date = {
      kind: "date" as const,
      millis: 1,
      authoritativeZone: "US/Eastern",
      dateOnly: true,
      display: "native display",
    };
    expect(nativeCellValue(date)).toEqual(date);
    expect(nativeCellValue(date)).not.toBe(date);
    const duration = {
      kind: "duration" as const,
      components: [1, 2, 3, 4, 5, 6, 7, 8] as const,
      display: "native duration",
    };
    expect(nativeCellValue(duration)).toEqual(duration);
  });
  it("preserves recursive values and safe own data keys", () => {
    const value = nativeCellValue({
      kind: "map",
      values: new Map([
        [
          "__proto__",
          {
            kind: "list",
            values: [
              { kind: "boolean", value: false },
              { kind: "number", value: -0 },
              { kind: "text", value: "[[a|label]]" },
            ],
          },
        ],
      ]),
    });
    expect(Object.hasOwn(value as object, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect((value as Record<string, unknown>).__proto__).toEqual([
      false,
      -0,
      "[[a|label]]",
    ]);
  });
});

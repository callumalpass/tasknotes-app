import { describe, expect, it } from "vitest";
import { monthDotCapacity } from "./use-calendar-month-layout";

describe("monthDotCapacity", () => {
  it("reserves the full count before fitting six-pixel dots and two-pixel gaps", () => {
    expect(monthDotCapacity(46, 20)).toBe(3);
    expect(monthDotCapacity(46, 28)).toBe(2);
    expect(monthDotCapacity(38, 28)).toBe(1);
  });
});

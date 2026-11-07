import { describe, expect, it } from "vitest";
import {
  isTimedCascadeSliver,
  readableTimedPlacement,
} from "./use-calendar-timed-layout";

describe("readableTimedPlacement", () => {
  it("leaves single items and roomy day-view columns side by side", () => {
    expect(readableTimedPlacement(140, 0, 1)).toBeUndefined();
    expect(readableTimedPlacement(1000, 0.8, 0.2)).toBeUndefined();
    expect(readableTimedPlacement(0, 0, 0.2)).toBeUndefined();
  });

  it.each([2, 3, 4, 5])(
    "cascades %i overlaps within their own day lane",
    (count) => {
      const placements = Array.from({ length: count }, (_, index) =>
        readableTimedPlacement(148, index / count, 1 / count)!,
      );
      expect(placements[0]!.left).toBe(0);
      for (const [index, placement] of placements.entries()) {
        expect(placement.width).toBeGreaterThanOrEqual(103);
        expect(placement.left + placement.width).toBeCloseTo(147);
        if (index)
          expect(placement.left).toBeGreaterThan(placements[index - 1]!.left);
      }
    },
  );

  it("bounds narrow tracked-time lanes without spilling into adjacent days", () => {
    expect(readableTimedPlacement(70, 0.5, 0.5)).toEqual({
      left: 17.5,
      width: 51.5,
    });
  });
});

describe("isTimedCascadeSliver", () => {
  const item = {
    left: 0,
    width: 147,
    top: 100,
    bottom: 200,
    titleBottom: 140,
  };

  it.each([2, 3, 4, 5])("hides narrow back strips for %i overlaps", (count) => {
    const siblings = Array.from({ length: count }, (_, index) => ({
      ...item,
      ...readableTimedPlacement(148, index / count, 1 / count)!,
    }));
    expect(
      siblings.map((entry) => isTimedCascadeSliver(entry, siblings)),
    ).toEqual(siblings.map((_, index) => index < count - 1));
  });

  it("keeps meaningful strips and fronts readable", () => {
    const later = { ...item, left: 50, width: 97 };
    expect(isTimedCascadeSliver(item, [item, later])).toBe(false);
    expect(isTimedCascadeSliver(later, [item, later])).toBe(false);
  });

  it("ignores cards below the title or outside the event", () => {
    expect(
      isTimedCascadeSliver(item, [
        { ...item, left: 12, top: 140 },
        { ...item, left: 24, top: 0, bottom: 100 },
      ]),
    ).toBe(false);
  });
});

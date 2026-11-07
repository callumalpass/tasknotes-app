import { describe, expect, it } from "vitest";
import { readableTimedPlacement } from "./use-calendar-timed-layout";

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

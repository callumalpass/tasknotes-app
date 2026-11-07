import { expect, it } from "vitest";
import {
  editOutlineDisplay,
  outlineReferences,
  outlineSourceOffset,
  outlineDisplayOffset,
} from "./outline-references";

const source = "Review [[Projects/Plan.md|the plan]] tomorrow";
it("displays reference labels without discarding the source", () => {
  expect(outlineReferences(source).display).toBe("Review the plan tomorrow");
  expect(outlineSourceOffset(source, 15)).toBe(source.indexOf(" tomorrow"));
  expect(outlineDisplayOffset(source, source.indexOf(" tomorrow"))).toBe(15);
});
it("preserves reference syntax when editing before and after a chip", () => {
  expect(
    editOutlineDisplay(source, "Please review the plan tomorrow").text,
  ).toBe("Please review [[Projects/Plan.md|the plan]] tomorrow");
  expect(editOutlineDisplay(source, "Review the plan next week").text).toBe(
    "Review [[Projects/Plan.md|the plan]] next week",
  );
});
it("deletes references atomically and inserts inside a label after the chip", () => {
  expect(editOutlineDisplay(source, "Review the pla tomorrow").text).toBe(
    "Review  tomorrow",
  );
  expect(editOutlineDisplay(source, "Review the NEWplan tomorrow").text).toBe(
    "Review [[Projects/Plan.md|the plan]]NEW tomorrow",
  );
});

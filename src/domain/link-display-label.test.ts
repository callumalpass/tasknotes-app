import { expect, it } from "vitest";
import { linkDisplayLabel } from "./completion";
it.each([
  ["[[Projects/Product refresh]]", "Product refresh"],
  ["[[Projects/Product refresh|Launch]]", "Launch"],
  ["[Launch](Projects/Product%20refresh.md)", "Launch"],
  ["office", "office"],
  ["", ""],
])("formats %s without changing its stored representation", (value, label) => {
  expect(linkDisplayLabel(value)).toBe(label);
});

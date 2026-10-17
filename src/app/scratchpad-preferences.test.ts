import { afterEach, expect, it } from "vitest";
import {
  initialScratchpadMode,
  saveScratchpadDefaultMode,
} from "./scratchpad-preferences";

afterEach(() =>
  window.localStorage.removeItem("tasknotes:scratchpad-default-mode:v1"),
);

it("uses the saved default only for empty notes", () => {
  saveScratchpadDefaultMode("markdown");
  expect(initialScratchpadMode("", true)).toBe("markdown");
  expect(initialScratchpadMode(" \n", true)).toBe("outline");
  expect(initialScratchpadMode("- [ ] Task\n", true)).toBe("outline");
  saveScratchpadDefaultMode("outline");
  expect(initialScratchpadMode("# Existing prose\n", false)).toBe("markdown");
});

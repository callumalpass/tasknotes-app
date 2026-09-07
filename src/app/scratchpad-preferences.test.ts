import { afterEach, expect, it } from "vitest";
import {
  initialScratchpadMode,
  loadScratchpadDefaultMode,
  saveScratchpadDefaultMode,
} from "./scratchpad-preferences";

afterEach(() =>
  window.localStorage.removeItem("tasknotes:scratchpad-default-mode:v1"),
);

it("defaults new notes to Outline", () => {
  expect(loadScratchpadDefaultMode()).toBe("outline");
  expect(initialScratchpadMode("", true)).toBe("outline");
});
it("uses the saved default only for empty notes", () => {
  saveScratchpadDefaultMode("markdown");
  expect(initialScratchpadMode("", true)).toBe("markdown");
  expect(initialScratchpadMode(" \n", true)).toBe("outline");
  expect(initialScratchpadMode("- [ ] Task\n", true)).toBe("outline");
  saveScratchpadDefaultMode("outline");
  expect(initialScratchpadMode("# Existing prose\n", false)).toBe("markdown");
});
it("ignores unknown preferences", () => {
  window.localStorage.setItem("tasknotes:scratchpad-default-mode:v1", "bad");
  expect(loadScratchpadDefaultMode()).toBe("outline");
});

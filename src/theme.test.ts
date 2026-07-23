import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyThemePreference,
  loadThemePreference,
  saveThemePreference,
} from "./theme";

describe("theme preference", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
  });

  it("uses the system setting for unsupported values", () => {
    localStorage.setItem("mdbase:theme", "sepia");
    expect(loadThemePreference()).toBe("system");
  });

  it("persists and applies an explicit theme", () => {
    saveThemePreference("dark");
    expect(localStorage.getItem("mdbase:theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    applyThemePreference("system");
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });
});

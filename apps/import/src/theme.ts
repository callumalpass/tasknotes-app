// Same preference vocabulary and storage key as TaskNotes app.
export const THEME_STORAGE_KEY = "mdbase:theme";
export const themePreferences = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof themePreferences)[number];

export function normalizeThemePreference(value: unknown): ThemePreference {
  return themePreferences.includes(value as ThemePreference)
    ? (value as ThemePreference)
    : "system";
}

export function loadThemePreference(): ThemePreference {
  try {
    return normalizeThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function applyThemePreference(preference: ThemePreference): void {
  if (preference === "system")
    document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = preference;
  const dark =
    preference === "dark" ||
    (preference === "system" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#1b1d23" : "#fbfcfe");
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Explicit selection still works for this page when storage is unavailable.
  }
  applyThemePreference(preference);
}

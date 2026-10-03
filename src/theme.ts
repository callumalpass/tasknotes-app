import * as theme from "@mdbase-dev/ui/theme";
export {
  THEME_STORAGE_KEY,
  themePreferences,
  normalizeThemePreference,
  loadThemePreference,
  type ThemePreference,
} from "@mdbase-dev/ui/theme";

// Keep TaskNotes' approved light browser-chrome color, not the shared canvas.
function chromeColor(): void {
  if (!theme.resolveDarkTheme())
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", "#fbfcfe");
}

export function applyThemePreference(preference: theme.ThemePreference): void {
  theme.applyThemePreference(preference);
  chromeColor();
}

export function saveThemePreference(preference: theme.ThemePreference): void {
  theme.saveThemePreference(preference);
  chromeColor();
}

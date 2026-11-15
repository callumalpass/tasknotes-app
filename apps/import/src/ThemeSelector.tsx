import { useEffect, useState } from "react";
import {
  THEME_STORAGE_KEY,
  applyThemePreference,
  loadThemePreference,
  normalizeThemePreference,
  saveThemePreference,
} from "./theme";

export function ThemeSelector() {
  const [preference, setPreference] = useState(loadThemePreference);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const updateAppearance = () => applyThemePreference(preference);
    const updateStoredPreference = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        setPreference(loadThemePreference());
      }
    };
    updateAppearance();
    media.addEventListener("change", updateAppearance);
    window.addEventListener("storage", updateStoredPreference);
    return () => {
      media.removeEventListener("change", updateAppearance);
      window.removeEventListener("storage", updateStoredPreference);
    };
  }, [preference]);

  return (
    <select
      className="theme-selector"
      aria-label="Appearance"
      value={preference}
      onChange={(event) => {
        const next = normalizeThemePreference(event.target.value);
        saveThemePreference(next);
        setPreference(next);
      }}
    >
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  );
}

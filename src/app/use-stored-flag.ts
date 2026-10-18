import { useState } from "react";

/** A per-device boolean that tolerates unavailable browser storage. */
export function useStoredFlag(key: string, fallback: boolean) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? fallback : stored === "true";
    } catch {
      return fallback;
    }
  });
  function update(next: boolean) {
    setValue(next);
    try {
      window.localStorage.setItem(key, String(next));
    } catch {
      // The choice still applies for this visit.
    }
  }
  return [value, update] as const;
}

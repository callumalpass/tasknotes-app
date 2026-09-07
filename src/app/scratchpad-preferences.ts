export type ScratchpadMode = "outline" | "markdown";
const STORAGE_KEY = "tasknotes:scratchpad-default-mode:v1";

export function loadScratchpadDefaultMode(): ScratchpadMode {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "markdown"
      ? "markdown"
      : "outline";
  } catch {
    return "outline";
  }
}

export function saveScratchpadDefaultMode(mode: ScratchpadMode): void {
  window.localStorage.setItem(STORAGE_KEY, mode);
}

export function initialScratchpadMode(
  body: string,
  outlineCompatible: boolean,
): ScratchpadMode {
  if (body.length === 0) return loadScratchpadDefaultMode();
  return outlineCompatible ? "outline" : "markdown";
}

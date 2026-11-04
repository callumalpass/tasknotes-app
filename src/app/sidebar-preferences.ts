const COLLAPSED_KEY = "tasknotes:sidebar-collapsed";

export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  } catch {
    // A display preference remains usable when browser storage is unavailable.
  }
}

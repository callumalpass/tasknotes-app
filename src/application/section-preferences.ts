export function sectionCollapsed(key?: string): boolean {
  try {
    return Boolean(key && localStorage.getItem(key) === "collapsed");
  } catch {
    return false;
  }
}
export function saveSectionCollapsed(
  key: string | undefined,
  collapsed: boolean,
) {
  try {
    if (key) localStorage.setItem(key, collapsed ? "collapsed" : "expanded");
  } catch {
    /* Presentation remains usable without persistence. */
  }
}

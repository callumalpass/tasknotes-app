const DEFAULT_PLANNER_URL = "https://planner.tasknotes.dev/";

export function plannerViewUrl(
  viewKey: string,
  collectionId?: string,
  baseUrl = import.meta.env.VITE_TASKNOTES_PLANNER_URL ?? DEFAULT_PLANNER_URL,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("view", viewKey);
  if (collectionId) url.searchParams.set("collection", collectionId);
  return url.toString();
}

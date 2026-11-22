/** A browser without the service-worker API cannot have a worker. */
export async function directSiteAvailable(
  site = location,
  workers: ServiceWorkerContainer | undefined = navigator.serviceWorker,
): Promise<boolean> {
  try {
    const clean = () =>
      window === window.top &&
      site.protocol === "https:" &&
      !workers?.controller;
    return (
      clean() &&
      (!workers || (await workers.getRegistrations()).length === 0) &&
      clean()
    );
  } catch {
    return false;
  }
}

/**
 * Remove what TaskNotes kept in this browser for collections on one server:
 * task drafts, recent searches and tasks, and per-collection view state. Each
 * such key embeds the collection identity, `direct:<server>/<collection>`.
 * A descriptor has no path, so the slash ends the server.
 */
export function clearDirectCollectionState(server: string): boolean {
  const scope = "direct:" + server + "/";
  try {
    for (const key of Object.keys(window.localStorage))
      if (key.startsWith("tasknotes:") && key.includes(scope))
        window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

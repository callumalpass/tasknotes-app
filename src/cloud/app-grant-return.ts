import manifest from "../generated/mdbase-app.json";

/** Where the SDK's Private collection grant window returns: the manifest's
 * first redirect URI on this origin, else the origin's root (as the SDK picks it). */
export function appGrantReturnPath(
  origin: string,
  redirectUris: readonly string[] = manifest.redirect_uris,
): string {
  for (const uri of redirectUris) {
    try {
      const url = new URL(uri);
      if (url.origin === origin) return url.pathname;
    } catch {
      // not a URL (e.g. a custom scheme): skip
    }
  }
  return "/";
}

/** The grant window landed back here with its result (`state` and `code` or `error`). */
export function isAppGrantReturn(
  url: URL,
  redirectUris?: readonly string[],
): boolean {
  return (
    url.pathname === appGrantReturnPath(url.origin, redirectUris) &&
    url.searchParams.has("state") &&
    (url.searchParams.has("code") || url.searchParams.has("error"))
  );
}

/** Hand the result to the TaskNotes tab waiting for it, which closes this
 * window. The grant code loads only here, never in the main bundle. */
export async function deliverAppGrantReturn(
  url: URL,
  load: () => Promise<{ deliverAppGrantCallback(url: string): void }> = () =>
    import("@mdbase-dev/sdk/app-grant"),
): Promise<void> {
  (await load()).deliverAppGrantCallback(url.href);
}

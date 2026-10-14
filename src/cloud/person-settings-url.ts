import { LOCAL_TASKNOTES_BUILD } from "./local-build";
import { isExactLocalOrigin } from "./app-environment";

/** Presentation destination only; never changes the selected collection,
 * identity, People resolution, or the authenticated mdbase authority. */
export function requirePersonEditorOrigin(value: unknown): string {
  if (LOCAL_TASKNOTES_BUILD && !isExactLocalOrigin(value))
    throw new Error(
      "Local TaskNotes requires an exact HTTP 127.0.0.1 Editor origin.",
    );
  if (typeof value === "string") {
    try {
      const url = new URL(value);
      if (
        url.origin === value &&
        (url.protocol === "https:" ||
          (url.protocol === "http:" &&
            url.hostname === "127.0.0.1" &&
            url.port !== "" &&
            Number(url.port) > 0))
      )
        return value;
    } catch {
      // Report only the configuration key, not the supplied value.
    }
  }
  throw new Error(
    "VITE_TASKNOTES_EDITOR_ORIGIN must select an exact HTTPS or HTTP loopback Editor origin.",
  );
}

/** The original authority URL supplies the collection and settings target.
 * Next app startup requires the configured origin; standalone/legacy consumers
 * without next build configuration retain their authority-supplied link. */
export function personSettingsUrl(
  href: string,
  configuredOrigin: string | undefined,
): string {
  if (configuredOrigin === undefined) return href;
  const origin = requirePersonEditorOrigin(configuredOrigin);
  const target = new URL(href);
  return origin + target.pathname + target.search + target.hash;
}

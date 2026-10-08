/** Deliberately has no production default until the new origin is approved. */
export const NEXT_ORIGIN_CONFIG_KEY = "VITE_TASKNOTES_NEXT_ORIGIN";

export function requireNextAppOrigin(
  configured: unknown,
  currentOrigin: string,
): string {
  if (typeof configured !== "string" || configured.length === 0)
    throw new Error(
      `${NEXT_ORIGIN_CONFIG_KEY} requires an approved next app origin.`,
    );
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(
      `${NEXT_ORIGIN_CONFIG_KEY} must be a canonical HTTPS origin.`,
    );
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== configured ||
    configured === "https://app.tasknotes.dev"
  )
    throw new Error(
      `${NEXT_ORIGIN_CONFIG_KEY} must be a distinct canonical HTTPS origin.`,
    );
  if (currentOrigin !== configured)
    throw new Error("TaskNotes must open at its configured next app origin.");
  return configured;
}

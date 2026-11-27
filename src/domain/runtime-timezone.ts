/** Return the current runtime's canonical IANA timezone. */
export function runtimeTimezone(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (
    !timezone ||
    timezone.toLowerCase() === "local" ||
    /^[+-]\d{2}:\d{2}$/.test(timezone)
  )
    throw new Error(
      "runtime_timezone_unavailable: This device did not expose an IANA timezone.",
    );
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new Error(
      `runtime_timezone_invalid: This device reported an invalid timezone (${timezone}).`,
    );
  }
  return timezone;
}

/** A configured zone belongs to this collection, including when the device travels. */
export function collectionTimezone(settings: unknown): string | undefined {
  if (
    typeof settings !== "object" ||
    settings === null ||
    !("timezone" in settings)
  )
    return undefined;
  const zone = settings.timezone;
  if (zone === undefined || zone === null) return undefined;
  if (typeof zone === "string" && zone && !/^(?:[+-]|local$)/i.test(zone)) {
    try {
      return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions()
        .timeZone;
    } catch {
      // Report a bad collection setting rather than using the device's zone.
    }
  }
  throw new Error(
    "collection_timezone_invalid: The collection did not provide a valid IANA timezone.",
  );
}

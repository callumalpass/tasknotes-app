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

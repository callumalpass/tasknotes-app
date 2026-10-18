// A retry briefly replaces the waiting screen with "Opening…", which remounts
// the cutover notice. Keep the backoff position across those remounts, and
// start over only after a long quiet period.
export const BACKOFF_RESET_MS = 15 * 60_000;
export const migratingBackoff = { attempt: 0, lastCheckAt: 0 };

export function resetMigratingBackoffForTests(): void {
  migratingBackoff.attempt = 0;
  migratingBackoff.lastCheckAt = 0;
}

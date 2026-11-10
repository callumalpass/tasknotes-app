import { appLocale } from "../i18n/app";

export function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Scratchpad dates use the same short month-and-day vocabulary as task rows. */
export function formatScratchDate(value: string, includeTime = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(appLocale(), {
    day: "numeric",
    month: "short",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

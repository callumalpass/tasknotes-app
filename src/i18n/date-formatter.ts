import { appLocale } from "./app";

// Task rows format many dates in one render. Keep the default device time
// zone fresh between renders, including when the device travels.
const formatters = new Map<string, Intl.DateTimeFormat>();
export function dateFormatter(options: Intl.DateTimeFormatOptions) {
  const locale = appLocale();
  const key = JSON.stringify([locale, options]);
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    if (!formatters.size) queueMicrotask(() => formatters.clear());
    formatters.set(key, formatter);
  }
  return formatter;
}

import { dateFormatter } from "./date-formatter";
import { t } from "@lingui/core/macro";
import { appLocale } from "./app";
import { builtInFieldLabel } from "./default-labels";
import { formatRelativeTaskDate } from "./presentation";
import { dateFromStorage } from "../domain/task";
import {
  formatPropertyValue as domainFormatPropertyValue,
  propertyLabel as domainPropertyLabel,
  relativeDateDetail as domainRelativeDateDetail,
  viewPropertyDetails as domainViewPropertyDetails,
  type ViewPropertyDetail,
} from "../domain/view-values";

export type { ViewPropertyDetail } from "../domain/view-values";

function fieldKey(key: string): string {
  const match = /^note\[(["'])(.+)\1\]$/.exec(key);
  return match?.[2] ?? key.replace(/^note\./, "");
}

export function propertyLabel(key: string): string {
  const field = fieldKey(key);
  // Preserve saved-property label wording; expression option labels intentionally use "File name/path".
  if (field === "file.name") return t`Name`;
  if (field === "file.path") return t`Path`;
  return builtInFieldLabel(field) ?? domainPropertyLabel(key);
}

/** Only display formatting changes; raw values, keys and explicit user labels are retained. */
export function formatPropertyValue(
  value: unknown,
  format?: string,
  timezone?: string,
): string | null {
  if (Array.isArray(value)) {
    const values = value
      .map((item) => formatPropertyValue(item, format, timezone))
      .filter((item): item is string => item !== null);
    return values.length ? values.join(", ") : null;
  }
  if (typeof value === "boolean") return value ? t`Yes` : t`No`;
  if (typeof value === "number")
    return new Intl.NumberFormat(appLocale()).format(value);
  if (typeof value === "string") {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
    if (format === "date" || dateOnly || dateTime) {
      const date = dateFromStorage(value, timezone);
      if (date)
        return dateFormatter({
          day: "numeric",
          month: "short",
          timeZone: dateTime ? timezone : undefined,
          ...(dateTime ? { hour: "numeric", minute: "2-digit" } : {}),
          year:
            date.getFullYear() === new Date().getFullYear()
              ? undefined
              : "numeric",
        }).format(date);
    }
  }
  // Reuse link, HTML-to-text, object and ordinary user-value handling without translating it.
  return domainFormatPropertyValue(value, format, timezone);
}

export function viewPropertyDetails(
  ...[row, properties, options]: Parameters<typeof domainViewPropertyDetails>
): ViewPropertyDetail[] | undefined {
  return domainViewPropertyDetails(row, properties, {
    ...options,
    formatValue: options?.formatValue ?? formatPropertyValue,
    labelFor: propertyLabel,
  });
}

export function relativeDateDetail<
  Detail extends {
    key: string;
    value: string;
    rawValue?: unknown;
    overdue?: boolean;
  },
>(
  detail: Detail,
  task: Parameters<typeof domainRelativeDateDetail>[1],
  configuration: Parameters<typeof domainRelativeDateDetail>[2],
): Detail & { overdue?: boolean } {
  return domainRelativeDateDetail(
    detail,
    task,
    configuration,
    formatRelativeTaskDate,
  );
}

export function groupLabel(entries: Array<[string, unknown]>): string {
  if (entries.length === 1) {
    const [field, value] = entries[0];
    const label = propertyLabel(field).toLocaleLowerCase(appLocale());
    return formatPropertyValue(value) ?? t`No ${label}`;
  }
  return entries
    .map(
      ([field, value]) =>
        `${propertyLabel(field)}: ${formatPropertyValue(value) ?? t`None`}`,
    )
    .join(" · ");
}

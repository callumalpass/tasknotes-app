import { t } from "@lingui/core/macro";
export function valueKey(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function columnLabel(value: unknown): string {
  if (value === null || value === "") return t({ message: "No value" });
  return String(value).replaceAll("-", " ");
}

/**
 * A column holding the empty option reads as the absence of that property
 * ("No status") rather than as a value named "None".
 */
export function kanbanColumnLabel(
  column: { value: unknown; label?: string },
  propertyName: string | null,
): string {
  const empty =
    column.value === null || column.value === "" || column.value === "none";
  if (empty && propertyName === "status") return t`No status`;
  if (empty && propertyName === "priority") return t`No priority`;
  return column.label ?? columnLabel(column.value);
}

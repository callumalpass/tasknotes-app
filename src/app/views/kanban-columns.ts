import { viewPropertyValue } from "../../domain/view-values";
import type { TaskViewRow } from "../../domain/view";

/** Presence, not truthiness/nullish fallback, determines authoritative values. */
export function kanbanRowValue(row: TaskViewRow, property: string): unknown {
  return viewPropertyValue(row, property) ?? null;
}

/** Group metadata order is authoritative when it describes this column
 * property. Reorder only supplied group columns: leave other configured/
 * discovered columns in their slots so empty-column keyboard moves do not
 * change unexpectedly. Never sort/recompute rows or switch on provider. */
export function orderedKanbanColumns<T extends { value: unknown }>(
  columns: readonly T[],
  groups: readonly { values: Record<string, unknown> }[],
  property: string,
): T[] {
  const byKey = new Map(
    columns.map((column) => [valueKey(column.value), column]),
  );
  const seen = new Set<string>();
  const ordered: T[] = [];
  for (const group of groups) {
    if (!Object.hasOwn(group.values, property)) continue;
    const key = valueKey(group.values[property]);
    const column = byKey.get(key);
    if (column && !seen.has(key)) {
      ordered.push(column);
      seen.add(key);
    }
  }
  let index = 0;
  return columns.map((column) =>
    seen.has(valueKey(column.value)) ? ordered[index++]! : column,
  );
}

export function valueKey(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function columnLabel(value: unknown): string {
  if (value === null || value === "") return "No value";
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
  if (empty && (propertyName === "status" || propertyName === "priority"))
    return `No ${propertyName}`;
  return column.label ?? columnLabel(column.value);
}

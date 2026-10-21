import { viewPropertyValue } from "../../domain/view-values";
import type { TaskViewRow } from "../../domain/view";

/** Presence, not truthiness/nullish fallback, determines authoritative values. */
export function kanbanRowValue(row: TaskViewRow, property: string): unknown {
  return viewPropertyValue(row, property) ?? null;
}

/** Configured columns (statuses, priorities, open/complete) keep the order
 * the user configured, empty or not, so moving a card never moves a column.
 * Values outside that configuration follow, in the provider's group order,
 * then in discovery order. Never sort/recompute rows or switch on provider. */
export function orderedKanbanColumns<T extends { value: unknown }>(
  columns: readonly T[],
  groups: readonly { values: Record<string, unknown> }[],
  property: string,
  configuredCount = 0,
): T[] {
  const configured = columns.slice(0, configuredCount);
  const discovered = columns.slice(configuredCount);
  const byKey = new Map(
    discovered.map((column) => [valueKey(column.value), column]),
  );
  const ordered: T[] = [];
  for (const group of groups) {
    if (!Object.hasOwn(group.values, property)) continue;
    const key = valueKey(group.values[property]);
    const column = byKey.get(key);
    if (!column) continue;
    ordered.push(column);
    byKey.delete(key);
  }
  return [...configured, ...ordered, ...byKey.values()];
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

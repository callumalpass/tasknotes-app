import type { EventInput } from "@fullcalendar/core";

import type { TaskSummary } from "../domain/task";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { ViewPropertyDetail } from "../domain/view-values";

export interface CalendarPriorityMarker {
  value: string;
  label: string;
  color: string;
}

/**
 * Calendar entries mark only priorities above the collection default, the
 * same threshold task rows use to show a priority at all. Ordinary, low and
 * completed work stays unmarked so titles keep the room.
 */
export function calendarPriorityMarker(
  task: TaskSummary,
  configuration: TaskCollectionConfiguration,
): CalendarPriorityMarker | undefined {
  if (task.completed || !task.priority || task.priority === "none") return;
  const priority = configuration.priorities.find(
    (option) => option.value === task.priority,
  );
  const fallback = configuration.priorities.find(
    (option) => option.value === configuration.defaults.priority,
  );
  if (!priority || priority.weight <= (fallback?.weight ?? 0)) return;
  return {
    value: priority.value,
    label: `${priority.label || priority.value} priority`,
    color: priority.color || "var(--ink-soft)",
  };
}

/** Distinct markers in display order, highest priority first, for the legend. */
export function calendarPriorityLegend(
  markers: Iterable<CalendarPriorityMarker | undefined>,
  configuration: TaskCollectionConfiguration,
): CalendarPriorityMarker[] {
  const byValue = new Map<string, CalendarPriorityMarker>();
  for (const marker of markers) if (marker) byValue.set(marker.value, marker);
  const weight = (value: string) =>
    configuration.priorities.find((option) => option.value === value)?.weight ??
    0;
  return [...byValue.values()].sort(
    (left, right) => weight(right.value) - weight(left.value),
  );
}

/**
 * Agenda rows and the selected-day list name an elevated priority in words
 * when the view's own properties do not already show it.
 */
export function withPriorityDetail<T extends ViewPropertyDetail>(
  details: readonly T[],
  marker: CalendarPriorityMarker | undefined,
  configuration: TaskCollectionConfiguration,
): Array<T | ViewPropertyDetail> {
  if (
    !marker ||
    details.some((detail) => isPriorityKey(detail.key, configuration))
  )
    return [...details];
  const priority = configuration.priorities.find(
    (option) => option.value === marker.value,
  );
  return [
    ...details,
    {
      key: "priority",
      label: "Priority",
      value: priority?.label || marker.value,
      rawValue: marker.value,
    },
  ];
}

/**
 * A due-day entry is labelled "Due" so a task shown twice is not a mystery;
 * where the entry's own details already say when it is due, the label only
 * repeats them.
 */
export function calendarEntryKind(
  kind: string | undefined,
  details: readonly ViewPropertyDetail[],
  detailsShown: boolean,
  configuration: TaskCollectionConfiguration,
): string | undefined {
  if (kind !== "Due" || !detailsShown) return kind;
  return details.some((detail) =>
    isMappedKey(detail.key, "due", configuration.fieldMapping.due),
  )
    ? undefined
    : kind;
}

export interface PendingCalendarMove {
  start: string;
  end?: string;
  allDay: boolean;
  /**
   * The view data current when the write was accepted; any later view data
   * reflects the write and supersedes the move.
   */
  settledWith?: unknown;
}

/**
 * FullCalendar draws a dropped event in its new place, but any re-render
 * before the refreshed view arrives would hand it the old dates again. Keep
 * the dropped dates until the write fails or fresh data replaces them.
 */
export function withPendingMoves(
  events: EventInput[],
  moves: ReadonlyMap<string, PendingCalendarMove>,
  execution: unknown,
): EventInput[] {
  if (!moves.size) return events;
  return events.map((event) => {
    const move = typeof event.id === "string" ? moves.get(event.id) : undefined;
    // View data newer than the accepted write already carries the move.
    if (!move || (move.settledWith && move.settledWith !== execution))
      return event;
    const moved: EventInput = {
      ...event,
      start: move.start,
      allDay: move.allDay,
    };
    if (move.end) moved.end = move.end;
    else delete moved.end;
    return moved;
  });
}

function isPriorityKey(
  key: string,
  configuration: TaskCollectionConfiguration,
): boolean {
  return isMappedKey(key, "priority", configuration.fieldMapping.priority);
}

function isMappedKey(key: string, field: string, mapped: string): boolean {
  const bracketed = /^note\[(["'])(.+)\1\]$/.exec(key);
  const name = bracketed?.[2] ?? key.replace(/^note\./, "");
  return name === field || name === mapped;
}

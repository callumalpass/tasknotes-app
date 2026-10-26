import type { CalendarItem } from "@tasknotes/calendar";
import { calendarItem, type CalendarEntry } from "../domain/calendar-events";
import { occurrenceTask, type TaskOccurrence } from "../domain/task-occurrence";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskViewExecution } from "../domain/view";
import {
  relativeDateDetail,
  viewPropertyDetails,
  type ViewPropertyDetail,
} from "../i18n/view-presentation";
import {
  calendarPriorityMarker,
  withPriorityDetail,
  type CalendarPriorityMarker,
} from "./calendar-event-presentation";

export interface CalendarEventMetadata {
  entry: CalendarEntry;
  dateField?: "scheduled" | "due";
  occurrence?: TaskOccurrence;
  timeEntryIndex?: number;
}

/** What an entry draws; the calendar redraws an item only when this changes. */
interface CalendarEventPresentation {
  marker?: CalendarPriorityMarker;
  details: (ViewPropertyDetail & { overdue?: boolean })[];
  kind?: string;
  recurring: boolean;
}

/**
 * Presentation plus the task records handlers act on. The records are left
 * out of the item's `rev`, so a change the calendar does not draw costs no
 * redraw; handlers still see the latest item passed to the calendar.
 */
export interface CalendarEventData extends CalendarEventPresentation {
  metadata: CalendarEventMetadata;
}

export type TaskCalendarItem = CalendarItem<CalendarEventData>;

export function calendarItems(
  entries: Map<string, CalendarEntry[]>,
  execution: TaskViewExecution,
  titleProperty: string,
  configuration: TaskCollectionConfiguration,
): { items: TaskCalendarItem[] } {
  const items: TaskCalendarItem[] = [];
  const seen = new Set<string>();
  for (const values of entries.values()) {
    for (const entry of values) {
      const neutral = entry.modelEntry;
      if (seen.has(neutral.id)) continue;
      seen.add(neutral.id);
      const displayed = entry.occurrence
        ? occurrenceTask(entry.occurrence)
        : entry.task;
      const tracked = neutral.type === "timeEntry";
      const marker = tracked
        ? undefined
        : calendarPriorityMarker(displayed, configuration);
      const details = tracked
        ? []
        : withPriorityDetail(
            viewPropertyDetails(entry.row, execution.view.properties, {
              identityProperty: titleProperty,
              occurrence: entry.occurrence,
            }) ?? [],
            marker,
            configuration,
          ).map((detail) =>
            relativeDateDetail(detail, displayed, configuration),
          );
      items.push({
        ...calendarItem(neutral),
        ...(tracked ? { color: "var(--success)" } : {}),
        className: [
          "task-calendar-event",
          neutral.isCompleted ? "is-complete" : "",
          neutral.recurringKind ? "is-recurring" : "",
          neutral.recurringKind === "next-scheduled" ? "is-recurring-next" : "",
          neutral.recurringKind === "pattern" ? "is-recurring-pattern" : "",
          tracked ? "is-time-entry" : "",
        ].filter(Boolean),
        data: {
          ...(marker ? { marker } : {}),
          details,
          ...(tracked
            ? { kind: "Tracked time" }
            : neutral.type === "due" && displayed.scheduled
              ? { kind: "Due" }
              : {}),
          recurring: Boolean(neutral.recurringKind),
          metadata: {
            entry,
            dateField: neutral.type === "due" ? "due" : "scheduled",
            occurrence: entry.occurrence,
            timeEntryIndex: neutral.timeEntryIndex,
          },
        },
      });
    }
  }
  return { items };
}

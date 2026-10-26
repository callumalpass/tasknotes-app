import type { CalendarChange, CalendarEntry } from "@tasknotes/model/calendar";

/** A gesture, not a stale task snapshot. Repositories plan against a fresh read. */
export interface CalendarTaskEdit {
  entry: CalendarEntry;
  change: CalendarChange;
  timezone: string;
  now?: string;
}

import { todayString } from "../domain/task";
import type { GoogleEvent } from "./client";

const DAY_MS = 86_400_000;

/** The civil days an event touches, read in this device's time zone. */
export interface EventSpan {
  allDay: boolean;
  start: Date;
  /** Exclusive, as the service sends it. */
  end: Date;
  firstDay: string;
  /** The last day the event touches: an event ending at midnight ends the day before. */
  lastDay: string;
  days: number;
}

/** Where one day falls in an event. */
export interface EventDayPart {
  position: "only" | "first" | "middle" | "last";
  /** Counted from one. */
  day: number;
  days: number;
}

function localDay(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
}

/** Whole days from one civil day to another; daylight saving cannot shorten it. */
function daysBetween(from: string, to: string): number {
  const utc = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return Date.UTC(year!, month! - 1, day!);
  };
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

export function shiftDay(date: string, days: number): string {
  const next = localDay(date);
  next.setDate(next.getDate() + days);
  return todayString(next);
}

export function eventSpan(event: GoogleEvent): EventSpan {
  const { start, end } = event;
  if (start.kind === "date") {
    // An all-day event's end is a date too; a malformed one lasts a day.
    const endDate = end.kind === "date" ? end.date : shiftDay(start.date, 1);
    const lastDay = endDate > start.date ? shiftDay(endDate, -1) : start.date;
    return {
      allDay: true,
      start: localDay(start.date),
      end: localDay(shiftDay(lastDay, 1)),
      firstDay: start.date,
      lastDay,
      days: daysBetween(start.date, lastDay) + 1,
    };
  }
  const startsAt = new Date(start.date_time);
  const endsAt =
    end.kind === "date_time" ? new Date(end.date_time) : localDay(end.date);
  const firstDay = todayString(startsAt);
  const lastDay = todayString(
    new Date(Math.max(startsAt.getTime(), endsAt.getTime() - 1)),
  );
  return {
    allDay: false,
    start: startsAt,
    end: endsAt,
    firstDay,
    lastDay,
    days: daysBetween(firstDay, lastDay) + 1,
  };
}

export function eventTouchesDay(span: EventSpan, day: string): boolean {
  return span.firstDay <= day && day <= span.lastDay;
}

export function eventDayPart(span: EventSpan, day: string): EventDayPart {
  const position =
    span.days === 1
      ? "only"
      : day <= span.firstDay
        ? "first"
        : day >= span.lastDay
          ? "last"
          : "middle";
  return {
    position,
    day: Math.min(span.days, Math.max(1, daysBetween(span.firstDay, day) + 1)),
    days: span.days,
  };
}

/**
 * A timed event lasting a day or longer belongs with all-day events, as Google
 * Calendar draws it: left in the hour grid it would fill whole columns and
 * squeeze everything else beside it.
 */
export function spansWholeDays(span: EventSpan): boolean {
  return !span.allDay && span.end.getTime() - span.start.getTime() >= DAY_MS;
}

import { t } from "@lingui/core/macro";
import { Formatter } from "@tasknotes/calendar";
import type { GoogleCalendar, GoogleEvent } from "./client";
import { eventDayPart, type EventSpan } from "./event-days";

/** A wall-clock time as the calendar writes it: "4pm", "10:30am" or "16:00". */
export type EventClock = (instant: Date) => string;

export function eventClock(
  locale: string,
  hour12: boolean | undefined,
): EventClock {
  const formatter = new Formatter(locale, hour12);
  return (instant) =>
    formatter.time(instant.getHours() * 60 + instant.getMinutes(), true);
}

/** Names the day an event ends on: the weekday within a week, the date beyond. */
function endDayName(span: EventSpan, locale: string): string {
  return new Intl.DateTimeFormat(
    locale,
    span.days <= 7 ? { weekday: "short" } : { month: "short", day: "numeric" },
  ).format(span.end);
}

/**
 * What an event is doing on one of its days. An event that starts today names
 * when it ends; one that carries on says so instead of repeating its hours.
 */
export function eventDayLabel(
  span: EventSpan,
  day: string,
  clock: EventClock,
  locale: string,
): string {
  const part = eventDayPart(span, day);
  const counted = () => {
    const { day, days } = part;
    return `${t`All day`} · ${t`Day ${day} of ${days}`}`;
  };
  if (span.allDay) return part.days === 1 ? t`All day` : counted();
  if (part.position === "only")
    return `${clock(span.start)} – ${clock(span.end)}`;
  if (part.position === "first")
    return `${clock(span.start)} – ${endDayName(span, locale)} ${clock(span.end)}`;
  if (part.position === "middle") return counted();
  const time = clock(span.end);
  return t`Until ${time}`;
}

/** The whole of an event's time, for a tooltip or a screen reader. */
export function eventRangeLabel(
  span: EventSpan,
  locale: string,
  hour12: boolean | undefined,
): string {
  const date = { weekday: "short", month: "short", day: "numeric" } as const;
  if (span.allDay) {
    const format = new Intl.DateTimeFormat(locale, date);
    // The exclusive end is the day after the last one.
    const last = new Date(span.end);
    last.setDate(last.getDate() - 1);
    return span.days === 1
      ? format.format(span.start)
      : format.formatRange(span.start, last);
  }
  return new Intl.DateTimeFormat(locale, {
    ...date,
    hour: "numeric",
    minute: "2-digit",
    ...(hour12 === undefined ? {} : { hour12 }),
  }).formatRange(span.start, span.end);
}

export function eventTitle(event: GoogleEvent): string {
  return event.title || t`(No title)`;
}

/** A timed event Google marks free: it is on the calendar without holding the time. */
export function isFree(event: GoogleEvent): boolean {
  return event.transparency === "transparent" && event.start.kind !== "date";
}

/**
 * How an event is drawn when it is not plainly a meeting the person is going
 * to. Filled means the time is held; the less sure that is, the less ink.
 */
export function eventStateClasses(event: GoogleEvent): string[] {
  const answer = event.self_response;
  if (answer === "declined") return ["is-declined"];
  return [
    answer === "needs_action" ? "is-unanswered" : "",
    event.status === "tentative" || answer === "tentative"
      ? "is-tentative"
      : "",
    isFree(event) ? "is-free" : "",
    event.event_type === "out_of_office" ? "is-out-of-office" : "",
  ].filter(Boolean);
}

/**
 * What sets an event apart from a meeting the person is going to: their answer
 * to the invitation, then the kind of time it is.
 */
export function eventNotes(event: GoogleEvent): string[] {
  const answer =
    event.self_response === "declined"
      ? t`Declined`
      : event.self_response === "needs_action"
        ? t`Not answered`
        : event.self_response === "tentative"
          ? t`Maybe`
          : "";
  const kind =
    event.event_type === "out_of_office"
      ? t`Out of office`
      : event.event_type === "focus_time"
        ? t`Focus time`
        : isFree(event) && event.self_response !== "declined"
          ? t`Free`
          : "";
  // Google titles these events with their kind unless the person renames them.
  const title = event.title?.trim().toLowerCase();
  return [answer, kind].filter((note) => note && note.toLowerCase() !== title);
}

/** An accessible name: what, how it stands, when, where and whose calendar. */
export function eventDescription(
  event: GoogleEvent,
  calendar: GoogleCalendar,
  when: string,
): string {
  return [
    eventTitle(event),
    ...eventNotes(event),
    when,
    event.location,
    calendar.name,
  ]
    .filter(Boolean)
    .join(", ");
}

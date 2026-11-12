import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { MapPin, Repeat } from "lucide-react";
import type { GoogleCalendar, GoogleEvent } from "./client";
import { eventSpan } from "./event-days";
import { eventDayLabel, eventTitle, type EventClock } from "./event-labels";

/**
 * One Google event on one day, read like a task row: the title, then when,
 * where and whose calendar. The calendar's tone stands where a task's
 * completion control would, so an event never looks like something to tick.
 */
export function GoogleEventRow({
  event,
  calendar,
  day,
  clock,
  locale,
}: {
  event: GoogleEvent;
  calendar: GoogleCalendar;
  day: string;
  clock: EventClock;
  /** The display locale dates are written in. */
  locale: string;
}) {
  // Subscribes the row's copy to a language change.
  useLingui();
  const declined = event.self_response === "declined";
  return (
    <span
      className={[
        "google-event-row",
        event.status === "tentative" ? "is-tentative" : "",
        declined ? "is-declined" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="google-event-row-tone" aria-hidden="true" />
      <span className="google-event-row-reading">
        <span className="google-event-row-title">
          {eventTitle(event)}
          {event.recurrence ? <Repeat aria-hidden="true" size={13} /> : null}
        </span>
        <span className="google-event-row-meta">
          {declined ? (
            <span className="google-event-row-response">
              <Trans>Declined</Trans>
            </span>
          ) : null}
          <span className="google-event-row-time">
            {eventDayLabel(eventSpan(event), day, clock, locale)}
          </span>
          {event.location ? (
            <span className="google-event-row-location">
              <MapPin aria-hidden="true" size={13} />
              <span>{event.location}</span>
            </span>
          ) : null}
          <span className="google-event-row-calendar">{calendar.name}</span>
        </span>
      </span>
    </span>
  );
}

import { useMemo, useState } from "react";
import type { ItemChangeArg } from "@tasknotes/calendar";
import type {
  CalendarEventData,
  TaskCalendarItem,
} from "../app/calendar-items";
import { runtimeTimezone } from "../domain/runtime-timezone";
import {
  calendarServiceClient,
  CalendarServiceError,
  type CalendarServiceFailure,
  type EventBoundary,
  type GoogleCalendar,
  type GoogleEvent,
} from "./client";
import { calendarTone } from "./calendar-tone";
import { eventSpan, shiftDay, spansWholeDays } from "./event-days";
import { movedFields, newEventDraft, type EventDraft } from "./event-draft";
import { eventStateClasses } from "./event-labels";
import { useCalendarService, useGoogleEvents } from "./use-calendar-service";

export type EventEditorRequest =
  | {
      kind: "existing";
      id: string;
      event: GoogleEvent;
      calendar: GoogleCalendar;
    }
  | { kind: "new"; draft: EventDraft; idempotencyKey: string };

export function googleItem(
  event: GoogleEvent,
  calendar: GoogleCalendar,
  /** The calendar's place among the person's calendars. */
  index: number,
): TaskCalendarItem {
  const span = eventSpan(event);
  // A timed event lasting a day or more is drawn across its days like an
  // all-day one. Dragging that bar would turn it into an all-day event and
  // lose its hours, so its times change in the editor only.
  const wholeDays = spansWholeDays(span);
  const instant = (boundary: EventBoundary) =>
    boundary.kind === "date" ? boundary.date : boundary.date_time;
  const movable = calendar.can_write && !wholeDays;
  return {
    id: `google:${event.id}`,
    title: event.title ?? "",
    start: wholeDays ? span.firstDay : instant(event.start),
    end: wholeDays ? shiftDay(span.lastDay, 1) : instant(event.end),
    allDay: span.allDay || wholeDays,
    kind: "google",
    color: calendarTone(calendar.color, index),
    editable: movable,
    startEditable: movable,
    durationEditable: movable,
    className: ["google-calendar-event", ...eventStateClasses(event)],
    data: {
      details: [],
      recurring: Boolean(event.recurrence),
      google: { event, calendar },
    },
  };
}

/** The events to draw, each in its calendar's colour. */
export function googleItems(
  events: readonly GoogleEvent[],
  calendars: readonly GoogleCalendar[],
): TaskCalendarItem[] {
  return events.flatMap((event) => {
    // Where someone is working is a note on the day, not something to attend.
    if (event.event_type === "working_location") return [];
    const index = calendars.findIndex(({ id }) => id === event.calendar_id);
    return index < 0 ? [] : [googleItem(event, calendars[index]!, index)];
  });
}

/** Everything the task calendar needs to draw and change Google events. */
export function useGoogleCalendarOverlay(range: { start: Date; end: Date }) {
  const service = useCalendarService();
  const loaded = useGoogleEvents(range);
  const [failure, setFailure] = useState<CalendarServiceFailure | null>(null);
  const [editor, setEditor] = useState<EventEditorRequest | null>(null);
  const { calendars } = service;
  const { events } = loaded;
  const items = useMemo(
    () => googleItems(events, calendars),
    [calendars, events],
  );
  const writable = calendars.filter(
    (calendar) => calendar.can_write && service.selected.includes(calendar.id),
  );

  async function move(info: ItemChangeArg<CalendarEventData>) {
    const google = info.item.data?.google;
    if (!google || !calendarServiceClient) return;
    setFailure(null);
    try {
      loaded.replaceEvent(
        await calendarServiceClient.updateEvent(
          google.event,
          movedFields(google.event, info, runtimeTimezone()),
        ),
      );
    } catch (reason) {
      info.revert();
      setFailure(
        reason instanceof CalendarServiceError ? reason.failure : "unavailable",
      );
    }
    // A recurring sibling's etag changes with this write, so read them again.
    loaded.reload();
  }

  return {
    enabled: calendarServiceClient !== null,
    signedIn: service.sessionId !== null,
    /** Google withdrew access; nothing is read until the person reconnects. */
    reconnect: service.connection?.status === "reconnect_required",
    items,
    writable,
    events,
    failure: failure ?? loaded.failure,
    omitted: loaded.omitted,
    loading: loaded.loading,
    reload: loaded.reload,
    replaceEvent: loaded.replaceEvent,
    move,
    editor,
    closeEditor: () => setEditor(null),
    open(google: { event: GoogleEvent; calendar: GoogleCalendar }) {
      setEditor({ kind: "existing", id: google.event.id, ...google });
    },
    create(date: string, slot: string) {
      setEditor({
        kind: "new",
        draft: newEventDraft(date, slot),
        idempotencyKey: crypto.randomUUID(),
      });
    },
  };
}

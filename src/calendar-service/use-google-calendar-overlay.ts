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
  type GoogleCalendar,
  type GoogleEvent,
} from "./client";
import { movedFields, newEventDraft, type EventDraft } from "./event-draft";
import { useCalendarService, useGoogleEvents } from "./use-calendar-service";

const TONES = 6;

export type EventEditorRequest =
  | {
      kind: "existing";
      id: string;
      event: GoogleEvent;
      calendar: GoogleCalendar;
    }
  | { kind: "new"; draft: EventDraft; idempotencyKey: string };

function googleItem(
  event: GoogleEvent,
  calendar: GoogleCalendar,
  tone: number,
): TaskCalendarItem {
  const { start, end } = event;
  return {
    id: `google:${event.id}`,
    title: event.title ?? "",
    start: start.kind === "date" ? start.date : start.date_time,
    end: end.kind === "date" ? end.date : end.date_time,
    allDay: start.kind === "date",
    kind: "google",
    color: `var(--google-calendar-tone-${tone})`,
    editable: calendar.can_write,
    startEditable: calendar.can_write,
    durationEditable: calendar.can_write,
    className: [
      "google-calendar-event",
      event.status === "tentative" ? "is-tentative" : "",
    ].filter(Boolean),
    data: {
      details: [],
      recurring: Boolean(event.recurrence),
      google: { event, calendar },
    },
  };
}

/** Everything the task calendar needs to draw and change Google events. */
export function useGoogleCalendarOverlay(range: { start: Date; end: Date }) {
  const service = useCalendarService();
  const loaded = useGoogleEvents(range);
  const [failure, setFailure] = useState<CalendarServiceFailure | null>(null);
  const [editor, setEditor] = useState<EventEditorRequest | null>(null);
  const { calendars } = service;
  const { events } = loaded;
  const items = useMemo(() => {
    const tones = new Map(
      calendars.map((calendar, index) => [calendar.id, index % TONES]),
    );
    return events.flatMap((event) => {
      const calendar = calendars.find(({ id }) => id === event.calendar_id);
      return calendar
        ? [googleItem(event, calendar, tones.get(calendar.id)!)]
        : [];
    });
  }, [calendars, events]);
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

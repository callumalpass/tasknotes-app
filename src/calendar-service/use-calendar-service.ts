import { useEffect, useState, useSyncExternalStore } from "react";
import {
  calendarServiceClient,
  CalendarServiceError,
  type CalendarServiceFailure,
  type CalendarServiceSnapshot,
  type GoogleEvent,
} from "./client";

const signedOut: CalendarServiceSnapshot = {
  sessionId: null,
  busy: false,
  awaitingCode: false,
  failure: null,
  connection: null,
  calendars: [],
  selected: [],
};
const subscribe = (listener: () => void) =>
  calendarServiceClient?.subscribe(listener) ?? (() => {});
const snapshot = () => calendarServiceClient?.getSnapshot() ?? signedOut;

export function useCalendarService(): CalendarServiceSnapshot {
  return useSyncExternalStore(subscribe, snapshot);
}

interface LoadedEvents {
  sessionId: string;
  events: GoogleEvent[];
  omitted: number;
  failure: CalendarServiceFailure | null;
}

/**
 * Selected calendars' events for a range. The previous range stays drawn until
 * the next arrives; another session's events are never shown.
 */
export function useGoogleEvents(range: { start: Date; end: Date }) {
  const { sessionId, calendars, selected, busy } = useCalendarService();
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<LoadedEvents | null>(null);
  const known = new Set(calendars.map((calendar) => calendar.id));
  const visible = selected.filter((id) => known.has(id));
  const visibleKey = visible.join();
  const start = range.start.getTime();
  const end = range.end.getTime();
  useEffect(() => {
    const client = calendarServiceClient;
    if (!client || !sessionId || !visibleKey) return;
    const controller = new AbortController();
    const { signal } = controller;
    void Promise.all(
      visibleKey
        .split(",")
        .map((id) => client.events(id, new Date(start), new Date(end), signal)),
    ).then(
      (results) => {
        if (signal.aborted) return;
        setLoaded({
          sessionId,
          events: results.flatMap((result) => result.events),
          omitted: results.reduce((sum, result) => sum + result.omitted, 0),
          failure: null,
        });
      },
      (reason: unknown) => {
        if (signal.aborted) return;
        setLoaded({
          sessionId,
          events: [],
          omitted: 0,
          failure:
            reason instanceof CalendarServiceError
              ? reason.failure
              : "unavailable",
        });
      },
    );
    return () => controller.abort();
  }, [sessionId, visibleKey, start, end, revision]);

  const current = loaded?.sessionId === sessionId ? loaded : null;
  return {
    events:
      current?.events.filter((event) => visible.includes(event.calendar_id)) ??
      [],
    omitted: current?.omitted ?? 0,
    failure: current?.failure ?? null,
    loading: Boolean(sessionId) && !busy && visible.length > 0 && !current,
    reload: () => setRevision((value) => value + 1),
    replaceEvent(event: GoogleEvent) {
      setLoaded(
        (value) =>
          value && {
            ...value,
            events: value.events.map((other) =>
              other.id === event.id ? event : other,
            ),
          },
      );
    },
  };
}

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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

/** Google never says an event changed, so what is shown is read again. */
const REFRESH_WHILE_SHOWN_MS = 5 * 60_000;
const REFRESH_ON_RETURN_MS = 60_000;

interface LoadedEvents {
  /** The session, calendars and range these were read for. */
  key: string;
  sessionId: string;
  events: GoogleEvent[];
  omitted: number;
  failure: CalendarServiceFailure | null;
}

/**
 * Selected calendars' events for a range. The previous range stays drawn until
 * the next arrives; another session's events are never shown. The range is read
 * again when the person returns to the app and every few minutes while it is
 * in front of them.
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
  const readAt = useRef(0);
  useEffect(() => {
    const client = calendarServiceClient;
    if (!client || !sessionId || !visibleKey) return;
    const controller = new AbortController();
    const { signal } = controller;
    const key = [sessionId, visibleKey, start, end].join("|");
    // One calendar that cannot be read does not take the others' events away.
    void Promise.allSettled(
      visibleKey
        .split(",")
        .map((id) => client.events(id, new Date(start), new Date(end), signal)),
    ).then((results) => {
      if (signal.aborted) return;
      readAt.current = Date.now();
      const read = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failed = results.find((result) => result.status === "rejected");
      const failure = !failed
        ? null
        : failed.reason instanceof CalendarServiceError
          ? failed.reason.failure
          : "unavailable";
      setLoaded((shown) =>
        // Reading the same events again and not reaching Google, as on a
        // device waking without a network, leaves what is shown in place.
        shown?.key === key &&
        (failure === "unavailable" || failure === "rate_limited")
          ? shown
          : {
              key,
              sessionId,
              events: read.flatMap((result) => result.events),
              omitted: read.reduce((sum, result) => sum + result.omitted, 0),
              failure,
            },
      );
    });
    return () => controller.abort();
  }, [sessionId, visibleKey, start, end, revision]);

  useEffect(() => {
    if (!sessionId || !visibleKey) return;
    const refresh = (staleAfter: number) => {
      if (
        document.visibilityState !== "visible" ||
        Date.now() - readAt.current < staleAfter
      )
        return;
      // Counted from here, so returning fires one read, not one per signal.
      readAt.current = Date.now();
      setRevision((value) => value + 1);
    };
    const onReturn = () => refresh(REFRESH_ON_RETURN_MS);
    const timer = setInterval(() => refresh(REFRESH_WHILE_SHOWN_MS), 60_000);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [sessionId, visibleKey]);

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

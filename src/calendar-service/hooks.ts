import { useEffect, useState, useSyncExternalStore } from "react";
import type { EventInput } from "@fullcalendar/core";
import { calendarLabClient, type CalendarSnapshot } from "./client";

const empty: CalendarSnapshot = {
  signedIn: false,
  busy: false,
  message: "",
  calendars: [],
  selected: [],
  connection: null,
};
const subscribe = (listener: () => void) =>
  calendarLabClient?.subscribe(listener) ?? (() => {});
const snapshot = () => calendarLabClient?.getSnapshot() ?? empty;
export const useCalendarLabSnapshot = () =>
  useSyncExternalStore(subscribe, snapshot);

export function useCalendarLabEvents(start: Date, endInclusive: Date) {
  const state = useCalendarLabSnapshot();
  const startValue = start.toISOString();
  const endValue = new Date(endInclusive.getTime() + 1).toISOString();
  const [result, setResult] = useState<{
    state: CalendarSnapshot;
    start: string;
    end: string;
    events: EventInput[];
    error: string;
  } | null>(null);
  useEffect(() => {
    const client = calendarLabClient;
    if (!client || !state.signedIn || state.busy || !state.selected.length)
      return;
    const controller = new AbortController();
    void Promise.all(
      state.selected.map((id) =>
        client.events(id, startValue, endValue, controller.signal),
      ),
    )
      .then((pages) => {
        if (!controller.signal.aborted)
          setResult({
            state,
            start: startValue,
            end: endValue,
            events: pages.flat(),
            error: "",
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({
            state,
            start: startValue,
            end: endValue,
            events: [],
            error:
              "External calendars could not be loaded. Try a shorter period or reconnect in Settings.",
          });
      });
    return () => controller.abort();
  }, [state, startValue, endValue]);
  const current =
    result?.state === state &&
    result.start === startValue &&
    result.end === endValue;
  return {
    events: current ? result.events : [],
    error: current ? result.error : "",
    loading:
      !!calendarLabClient &&
      state.signedIn &&
      !state.busy &&
      state.selected.length > 0 &&
      !current,
  };
}

import type { EventBoundary, EventFields, GoogleEvent } from "./client";

/** Form state: `start`/`end` are local `datetime-local` or inclusive date values. */
export interface EventDraft {
  title: string;
  location: string;
  description: string;
  allDay: boolean;
  start: string;
  end: string;
}

function padded(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateTime(instant: string): string {
  const date = new Date(instant);
  return (
    `${date.getFullYear()}-${padded(date.getMonth() + 1)}-${padded(date.getDate())}` +
    `T${padded(date.getHours())}:${padded(date.getMinutes())}`
  );
}

function shiftDate(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function eventDraft(event: GoogleEvent): EventDraft {
  const { start, end } = event;
  const shared = {
    title: event.title ?? "",
    location: event.location ?? "",
    description: event.description ?? "",
  };
  return start.kind === "date" && end.kind === "date"
    ? {
        ...shared,
        allDay: true,
        start: start.date,
        // Service dates end exclusively; people read the last day.
        end: shiftDate(end.date, -1),
      }
    : {
        ...shared,
        allDay: false,
        start: localDateTime((start as { date_time: string }).date_time),
        end: localDateTime((end as { date_time: string }).date_time),
      };
}

/** A new event at a day (all-day) or a slot (one hour). */
export function newEventDraft(date: string, slot: string): EventDraft {
  const timed = slot.includes("T");
  const start = timed ? localDateTime(slot) : date;
  return {
    title: "",
    location: "",
    description: "",
    allDay: !timed,
    start,
    end: timed
      ? localDateTime(new Date(Date.parse(slot) + 3_600_000).toISOString())
      : date,
  };
}

export function withAllDay(draft: EventDraft, allDay: boolean): EventDraft {
  if (draft.allDay === allDay) return draft;
  const [start, end] = [draft.start.slice(0, 10), draft.end.slice(0, 10)];
  return allDay
    ? { ...draft, allDay, start, end }
    : { ...draft, allDay, start: `${start}T09:00`, end: `${end}T10:00` };
}

export function draftIsValid(draft: EventDraft): boolean {
  return draft.allDay
    ? Boolean(draft.start && draft.end) && draft.start <= draft.end
    : Date.parse(draft.end) > Date.parse(draft.start);
}

function draftBoundary(
  value: string,
  allDay: boolean,
  timeZone: string,
): EventBoundary {
  return allDay
    ? { kind: "date", date: value }
    : {
        kind: "date_time",
        date_time: new Date(value).toISOString(),
        time_zone: timeZone,
      };
}

export function draftFields(
  draft: EventDraft,
  timeZone: string,
): EventFields & { start: EventBoundary; end: EventBoundary } {
  return {
    title: draft.title,
    location: draft.location,
    description: draft.description,
    start: draftBoundary(draft.start, draft.allDay, timeZone),
    end: draftBoundary(
      draft.allDay ? shiftDate(draft.end, 1) : draft.end,
      draft.allDay,
      timeZone,
    ),
  };
}

function timesDiffer(before: EventDraft, after: EventDraft): boolean {
  return (
    before.allDay !== after.allDay ||
    before.start !== after.start ||
    before.end !== after.end
  );
}

/** Carries the person's edits onto a newer event; the rest follows Google. */
export function rebaseDraft(
  before: EventDraft,
  draft: EventDraft,
  latest: EventDraft,
): EventDraft {
  const { allDay, start, end } = timesDiffer(before, draft) ? draft : latest;
  return {
    title: draft.title === before.title ? latest.title : draft.title,
    location:
      draft.location === before.location ? latest.location : draft.location,
    description:
      draft.description === before.description
        ? latest.description
        : draft.description,
    allDay,
    start,
    end,
  };
}

/** Only what changed, so a title edit cannot rewrite an event's time zone. */
export function changedFields(
  event: GoogleEvent,
  draft: EventDraft,
  timeZone: string,
): EventFields {
  const before = eventDraft(event);
  const fields = draftFields(draft, eventTimeZone(event) ?? timeZone);
  return {
    ...(before.title !== draft.title ? { title: fields.title } : {}),
    ...(before.location !== draft.location
      ? { location: fields.location }
      : {}),
    ...(before.description !== draft.description
      ? { description: fields.description }
      : {}),
    ...(timesDiffer(before, draft)
      ? { start: fields.start, end: fields.end }
      : {}),
  };
}

function eventTimeZone(event: GoogleEvent): string | undefined {
  return event.start.kind === "date_time" ? event.start.time_zone : undefined;
}

/** What a calendar drag or resize means. `end` stays exclusive here. */
export function movedFields(
  event: GoogleEvent,
  move: {
    start: Date;
    end: Date;
    startStr: string;
    endStr: string;
    allDay: boolean;
  },
  timeZone: string,
): { start: EventBoundary; end: EventBoundary } {
  if (move.allDay)
    return {
      start: { kind: "date", date: move.startStr.slice(0, 10) },
      end: { kind: "date", date: move.endStr.slice(0, 10) },
    };
  const time_zone = eventTimeZone(event) ?? timeZone;
  return {
    start: {
      kind: "date_time",
      date_time: move.start.toISOString(),
      time_zone,
    },
    end: { kind: "date_time", date_time: move.end.toISOString(), time_zone },
  };
}

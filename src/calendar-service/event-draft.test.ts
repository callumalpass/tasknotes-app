import { describe, expect, it } from "vitest";
import type { GoogleEvent } from "./client";
import {
  changedFields,
  draftFields,
  draftIsValid,
  eventDraft,
  movedFields,
  newEventDraft,
  rebaseDraft,
  withAllDay,
} from "./event-draft";

const base = {
  status: "confirmed",
  id: "e1_event",
  etag: '"1"',
  calendar_id: "6f0e9a52-3a55-4c5e-9d1c-3d8c6d6c3f11",
  title: "Standup",
  description: null,
  location: null,
  recurrence: null,
} as const;
const timed: GoogleEvent = {
  ...base,
  start: {
    kind: "date_time",
    date_time: "2026-11-09T01:00:00Z",
    time_zone: "Asia/Tokyo",
  },
  end: {
    kind: "date_time",
    date_time: "2026-11-09T02:00:00Z",
    time_zone: "Asia/Tokyo",
  },
};
const allDay: GoogleEvent = {
  ...base,
  start: { kind: "date", date: "2026-11-09" },
  end: { kind: "date", date: "2026-11-11" },
};

describe("Google event drafts", () => {
  it("keeps only the person's edits when a conflict brings a newer event", () => {
    const before = eventDraft(timed);
    const latest: GoogleEvent = {
      ...timed,
      etag: '"2"',
      title: "Moved standup",
      start: {
        kind: "date_time",
        date_time: "2026-11-09T03:00:00Z",
        time_zone: "Asia/Tokyo",
      },
      end: {
        kind: "date_time",
        date_time: "2026-11-09T04:00:00Z",
        time_zone: "Asia/Tokyo",
      },
    };
    const rebased = rebaseDraft(
      before,
      { ...before, location: "Room 2" },
      eventDraft(latest),
    );
    expect(rebased).toEqual({ ...eventDraft(latest), location: "Room 2" });
    // Saving again must not restore the times the other change replaced.
    expect(changedFields(latest, rebased, "UTC")).toEqual({
      location: "Room 2",
    });
  });

  it("keeps edited times over a newer event's times", () => {
    const before = eventDraft(timed);
    const edited = { ...before, start: "2030-01-01T09:00" };
    const latest = { ...before, start: "2031-01-01T09:00", title: "New" };
    expect(rebaseDraft(before, edited, latest)).toEqual({
      ...edited,
      title: "New",
    });
  });

  it("shows an exclusive all-day end as the last day and restores it", () => {
    const draft = eventDraft(allDay);
    expect(draft).toMatchObject({
      allDay: true,
      start: "2026-11-09",
      end: "2026-11-10",
    });
    expect(draftFields(draft, "UTC").end).toEqual({
      kind: "date",
      date: "2026-11-11",
    });
  });

  it("sends nothing for an unchanged event", () => {
    expect(changedFields(timed, eventDraft(timed), "UTC")).toEqual({});
    expect(changedFields(allDay, eventDraft(allDay), "UTC")).toEqual({});
  });

  it("leaves times out of a title edit, so the zone is not rewritten", () => {
    const draft = { ...eventDraft(timed), title: "Retro" };
    expect(changedFields(timed, draft, "UTC")).toEqual({ title: "Retro" });
  });

  it("keeps an event's own time zone when its time changes", () => {
    const draft = { ...eventDraft(timed), end: "2030-01-01T10:00" };
    const fields = changedFields(timed, draft, "UTC");
    expect(fields.end).toMatchObject({ time_zone: "Asia/Tokyo" });
    expect(fields.start).toMatchObject({ time_zone: "Asia/Tokyo" });
  });

  it("clears a description explicitly rather than omitting it", () => {
    const event = { ...timed, description: "Agenda" };
    expect(
      changedFields(event, { ...eventDraft(event), description: "" }, "UTC"),
    ).toEqual({ description: "" });
  });

  it("starts from a day or from a slot", () => {
    expect(newEventDraft("2026-11-09", "2026-11-09")).toMatchObject({
      allDay: true,
      start: "2026-11-09",
      end: "2026-11-09",
    });
    expect(newEventDraft("2026-11-09", "2026-11-09T14:30:00")).toMatchObject({
      allDay: false,
      start: "2026-11-09T14:30",
      end: "2026-11-09T15:30",
    });
  });

  it("converts between timed and all-day", () => {
    const draft = newEventDraft("2026-11-09", "2026-11-09");
    const timedDraft = withAllDay(draft, false);
    expect(timedDraft).toMatchObject({
      start: "2026-11-09T09:00",
      end: "2026-11-09T10:00",
    });
    expect(withAllDay(timedDraft, true)).toMatchObject({
      start: "2026-11-09",
      end: "2026-11-09",
    });
  });

  it("rejects an end before the start, but allows a one-day all-day event", () => {
    expect(
      draftIsValid({
        ...newEventDraft("2026-11-09", "2026-11-09T14:30:00"),
        end: "2026-11-09T14:30",
      }),
    ).toBe(false);
    expect(draftIsValid(newEventDraft("2026-11-09", "2026-11-09"))).toBe(true);
    expect(
      draftIsValid({
        ...newEventDraft("2026-11-09", "2026-11-09"),
        end: "2026-11-08",
      }),
    ).toBe(false);
  });

  it("maps a timed drag to instants in the event's zone", () => {
    const start = new Date("2026-11-10T03:00:00Z");
    const end = new Date("2026-11-10T04:00:00Z");
    expect(
      movedFields(
        timed,
        { start, end, startStr: "", endStr: "", allDay: false },
        "UTC",
      ),
    ).toEqual({
      start: {
        kind: "date_time",
        date_time: "2026-11-10T03:00:00.000Z",
        time_zone: "Asia/Tokyo",
      },
      end: {
        kind: "date_time",
        date_time: "2026-11-10T04:00:00.000Z",
        time_zone: "Asia/Tokyo",
      },
    });
  });

  it("keeps a dragged all-day event's exclusive end", () => {
    expect(
      movedFields(
        allDay,
        {
          start: new Date(0),
          end: new Date(0),
          startStr: "2026-11-12",
          endStr: "2026-11-14",
          allDay: true,
        },
        "UTC",
      ),
    ).toEqual({
      start: { kind: "date", date: "2026-11-12" },
      end: { kind: "date", date: "2026-11-14" },
    });
  });
});

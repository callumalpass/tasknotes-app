import { describe, expect, it } from "vitest";
import type { GoogleEvent } from "./client";
import {
  eventDayPart,
  eventSpan,
  eventTouchesDay,
  shiftDay,
  spansWholeDays,
} from "./event-days";
import { eventClock, eventDayLabel, eventDescription } from "./event-labels";
import { googleItem, googleItems } from "./use-google-calendar-overlay";

const base = {
  status: "confirmed",
  id: "e1_event",
  etag: '"1"',
  calendar_id: "6f0e9a52-3a55-4c5e-9d1c-3d8c6d6c3f11",
  title: "Ezra",
  description: null,
  location: null,
  recurrence: null,
} as const;
const calendar = {
  id: base.calendar_id,
  name: "Home",
  can_write: true,
  is_primary: true,
};

/** A wall-clock instant on this device, so the days hold in any time zone. */
function at(day: number, hour: number, minute = 0) {
  return {
    kind: "date_time" as const,
    date_time: new Date(2026, 10, day, hour, minute).toISOString(),
  };
}
const on = (date: string) => ({ kind: "date" as const, date });
const timed = (start: ReturnType<typeof at>, end: ReturnType<typeof at>) =>
  ({ ...base, start, end }) satisfies GoogleEvent;
const clock = eventClock("en", true);
const label = (event: GoogleEvent, day: string) =>
  eventDayLabel(eventSpan(event), day, clock, "en");

describe("the days an event touches", () => {
  it("keeps an event inside one day to that day", () => {
    const span = eventSpan(timed(at(12, 9, 30), at(12, 9, 45)));
    expect(span).toMatchObject({
      allDay: false,
      firstDay: "2026-11-12",
      lastDay: "2026-11-12",
      days: 1,
    });
    expect(eventDayPart(span, "2026-11-12").position).toBe("only");
    expect(spansWholeDays(span)).toBe(false);
  });

  it("ends an event that stops at midnight on the day before", () => {
    const span = eventSpan(timed(at(12, 20), at(13, 0)));
    expect(span.lastDay).toBe("2026-11-12");
    expect(eventTouchesDay(span, "2026-11-13")).toBe(false);
  });

  it("carries an overnight event into its second day without calling it whole days", () => {
    const span = eventSpan(timed(at(14, 22, 15), at(15, 1, 40)));
    expect(span.days).toBe(2);
    expect(eventDayPart(span, "2026-11-14").position).toBe("first");
    expect(eventDayPart(span, "2026-11-15").position).toBe("last");
    expect(spansWholeDays(span)).toBe(false);
  });

  it("counts every day of a timed event across several", () => {
    const span = eventSpan(timed(at(11, 16), at(13, 10, 30)));
    expect(span).toMatchObject({
      firstDay: "2026-11-11",
      lastDay: "2026-11-13",
      days: 3,
    });
    expect(eventTouchesDay(span, "2026-11-10")).toBe(false);
    expect(eventDayPart(span, "2026-11-12")).toEqual({
      position: "middle",
      day: 2,
      days: 3,
    });
    expect(spansWholeDays(span)).toBe(true);
  });

  it("reads an all-day event's exclusive end as its last day", () => {
    const span = eventSpan({
      ...base,
      start: on("2026-11-13"),
      end: on("2026-11-16"),
    });
    expect(span).toMatchObject({
      allDay: true,
      firstDay: "2026-11-13",
      lastDay: "2026-11-15",
      days: 3,
    });
    expect(spansWholeDays(span)).toBe(false);
  });

  it("steps days across a month's end", () => {
    expect(shiftDay("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("what an event says on each of its days", () => {
  it("gives a single day its hours", () => {
    expect(label(timed(at(12, 9, 30), at(12, 9, 45)), "2026-11-12")).toBe(
      "9:30am – 9:45am",
    );
  });

  it("names the end day where a long event starts, then stops repeating its hours", () => {
    const event = timed(at(11, 16), at(13, 10, 30));
    expect(label(event, "2026-11-11")).toBe("4pm – Fri 10:30am");
    expect(label(event, "2026-11-12")).toBe("All day · Day 2 of 3");
    expect(label(event, "2026-11-13")).toBe("Until 10:30am");
  });

  it("names the date when the end is more than a week away", () => {
    expect(label(timed(at(2, 9), at(20, 17)), "2026-11-02")).toBe(
      "9am – Nov 20 5pm",
    );
  });

  it("follows a twenty-four hour clock", () => {
    const span = eventSpan(timed(at(11, 16), at(13, 10, 30)));
    expect(
      eventDayLabel(span, "2026-11-13", eventClock("en", false), "en"),
    ).toBe("Until 10:30");
  });

  it("counts the days of an all-day event only when there are several", () => {
    const one = { ...base, start: on("2026-11-12"), end: on("2026-11-13") };
    const three = { ...base, start: on("2026-11-13"), end: on("2026-11-16") };
    expect(label(one, "2026-11-12")).toBe("All day");
    expect(label(three, "2026-11-15")).toBe("All day · Day 3 of 3");
  });

  it("describes an event by what, when, where and whose calendar", () => {
    expect(
      eventDescription(
        { ...base, title: null, location: "Room 4.02" } as GoogleEvent,
        calendar,
        "All day",
      ),
    ).toBe("(No title), All day, Room 4.02, Home");
  });
});

describe("a Google event as a calendar item", () => {
  it("leaves an event shorter than a day in the hour grid, movable", () => {
    const event = timed(at(14, 22, 15), at(15, 1, 40));
    expect(googleItem(event, calendar, 0)).toMatchObject({
      start: event.start.date_time,
      end: event.end.date_time,
      allDay: false,
      editable: true,
    });
  });

  it("draws a timed event of a day or more across its days, changed in the editor only", () => {
    expect(
      googleItem(timed(at(11, 16), at(13, 10, 30)), calendar, 0),
    ).toMatchObject({
      start: "2026-11-11",
      end: "2026-11-14",
      allDay: true,
      editable: false,
      startEditable: false,
      durationEditable: false,
    });
  });

  it("takes Google's colour for its calendar, or a tone by position without one", () => {
    const event = timed(at(14, 9), at(14, 10));
    expect(googleItem(event, calendar, 4).color).toBe(
      "var(--google-calendar-tone-4)",
    );
    expect(
      googleItem(event, { ...calendar, color: "#039be5" }, 4).color,
    ).toMatch(/^oklch\(55% /);
  });

  it("marks an event the person declined and says so in its name", () => {
    const event = timed(at(14, 9), at(14, 10));
    const declined = { ...event, self_response: "declined" };
    expect(googleItem(declined, calendar, 0).className).toContain(
      "is-declined",
    );
    expect(eventDescription(declined, calendar, "9am – 10am")).toBe(
      "Ezra, Declined, 9am – 10am, Home",
    );
    for (const self_response of ["accepted", "needs_action", null, undefined]) {
      expect(
        googleItem({ ...event, self_response }, calendar, 0).className,
      ).not.toContain("is-declined");
    }
  });

  it("leaves out working locations and events of calendars it does not know", () => {
    const event = timed(at(14, 9), at(14, 10));
    const other = { ...calendar, id: "0f0e9a52-3a55-4c5e-9d1c-3d8c6d6c3f12" };
    const items = googleItems(
      [
        { ...event, id: "e1_office", event_type: "working_location" },
        { ...event, id: "e1_focus", event_type: "focus_time" },
        { ...event, id: "e1_later", event_type: "something_new" },
        { ...event, id: "e1_plain" },
        { ...event, id: "e1_unknown", calendar_id: crypto.randomUUID() },
        { ...event, id: "e1_other", calendar_id: other.id },
      ],
      [calendar, other],
    );
    expect(items.map((item) => item.id)).toEqual([
      "google:e1_focus",
      "google:e1_later",
      "google:e1_plain",
      "google:e1_other",
    ]);
    expect(items[3]!.color).toBe("var(--google-calendar-tone-1)");
  });

  it("keeps a read-only calendar's events fixed", () => {
    const event = { ...base, start: on("2026-11-12"), end: on("2026-11-13") };
    expect(
      googleItem(event, { ...calendar, can_write: false }, 1),
    ).toMatchObject({ allDay: true, editable: false });
  });
});

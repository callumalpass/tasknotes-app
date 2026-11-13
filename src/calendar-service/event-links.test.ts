import { describe, expect, it } from "vitest";
import type { GoogleEvent } from "./client";
import { eventLinks } from "./event-links";

const event = (links: Partial<GoogleEvent>): GoogleEvent => ({
  status: "confirmed",
  id: "e1_event",
  etag: '"1"',
  calendar_id: "6f0e9a52-3a55-4c5e-9d1c-3d8c6d6c3f11",
  title: "Planning",
  description: null,
  location: null,
  recurrence: null,
  start: { kind: "date", date: "2026-11-09" },
  end: { kind: "date", date: "2026-11-10" },
  ...links,
});

describe("an event's links", () => {
  it("offers the call with its host, and the event's page in Google Calendar", () => {
    expect(
      eventLinks(
        event({
          conference_link: "https://meet.google.com/abc-defg-hij",
          web_link: "https://www.google.com/calendar/event?eid=abc",
        }),
      ),
    ).toEqual({
      join: {
        href: "https://meet.google.com/abc-defg-hij",
        host: "meet.google.com",
      },
      google: "https://www.google.com/calendar/event?eid=abc",
    });
    expect(
      eventLinks(event({ conference_link: "https://example.zoom.us/j/1" })).join
        ?.host,
    ).toBe("example.zoom.us");
  });

  it("offers nothing from an older service or an event without links", () => {
    const none = { join: null, google: null };
    expect(eventLinks(event({}))).toEqual(none);
    expect(
      eventLinks(event({ conference_link: null, web_link: null })),
    ).toEqual(none);
  });

  it.each([
    "http://meet.google.com/abc",
    "javascript:alert(1)",
    "https://user:secret@meet.google.com/abc",
    "meet.google.com/abc",
    "",
  ])("refuses the join link %s", (conference_link) => {
    expect(eventLinks(event({ conference_link })).join).toBeNull();
  });

  it.each([
    "https://calendar.google.com.example.test/event",
    "https://example.test/calendar/event?eid=abc",
    "http://www.google.com/calendar/event?eid=abc",
    "https://www.google.com@example.test/",
  ])("opens only Google Calendar's own pages, not %s", (web_link) => {
    expect(eventLinks(event({ web_link })).google).toBeNull();
  });
});

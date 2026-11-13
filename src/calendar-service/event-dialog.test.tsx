// @vitest-environment jsdom
import { render, screen } from "../test/render";
import { describe, expect, it, vi } from "vitest";
import type { GoogleEvent } from "./client";

vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  calendarServiceClient: {},
}));

const { GoogleEventDialog } = await import("./event-dialog");

const calendar = {
  id: "6f0e9a52-3a55-4c5e-9d1c-3d8c6d6c3f11",
  name: "Work",
  can_write: false,
  is_primary: true,
};
const event: GoogleEvent = {
  status: "confirmed",
  id: "e1_event",
  etag: '"1"',
  calendar_id: calendar.id,
  title: "Planning",
  description: null,
  location: null,
  recurrence: null,
  start: { kind: "date", date: "2026-11-09" },
  end: { kind: "date", date: "2026-11-10" },
};

function open(links: Partial<GoogleEvent>) {
  const shown = { ...event, ...links };
  return render(
    <GoogleEventDialog
      request={{ kind: "existing", id: shown.id, event: shown, calendar }}
      events={[shown]}
      writable={[]}
      onClose={vi.fn()}
      onSaved={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
}

describe("an event's links in its dialog", () => {
  it("joins the call and opens Google Calendar in a new tab, cut off from this one", () => {
    open({
      conference_link: "https://meet.google.com/abc-defg-hij",
      web_link: "https://www.google.com/calendar/event?eid=abc",
    });
    const join = screen.getByRole("link", { name: /Join meeting/ });
    expect(join).toHaveAttribute(
      "href",
      "https://meet.google.com/abc-defg-hij",
    );
    expect(join).toHaveTextContent("meet.google.com");
    const google = screen.getByRole("link", {
      name: "Open in Google Calendar",
    });
    expect(google).toHaveAttribute(
      "href",
      "https://www.google.com/calendar/event?eid=abc",
    );
    for (const link of [join, google]) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("shows no links for an event that has none, even on a read-only calendar", () => {
    open({ conference_link: "javascript:alert(1)", web_link: null });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

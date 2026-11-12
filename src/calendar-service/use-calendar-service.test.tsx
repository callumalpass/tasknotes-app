// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GoogleEvent } from "./client";

const WORK = "6f0e9a52-3a55-4c5e-9d1c-3d8c6d6c3f11";
const TEAM = "7a1e9a52-3a55-4c5e-9d1c-3d8c6d6c3f22";
const range = {
  start: new Date("2026-11-01T00:00:00Z"),
  end: new Date("2026-12-01T00:00:00Z"),
};
const event = (calendar_id: string): GoogleEvent => ({
  status: "confirmed",
  id: `e1_${calendar_id.slice(0, 4)}`,
  etag: '"1"',
  calendar_id,
  title: "Planning",
  description: null,
  location: null,
  recurrence: null,
  start: { kind: "date", date: "2026-11-09" },
  end: { kind: "date", date: "2026-11-10" },
});
const events = vi.fn();

vi.mock("./client", async (original) => {
  const actual = await original<typeof import("./client")>();
  const calendar = (id: string) => ({
    id,
    name: id,
    can_write: true,
    is_primary: false,
  });
  const snapshot = {
    sessionId: "session",
    busy: false,
    awaitingCode: false,
    failure: null,
    connection: null,
    calendars: [calendar(WORK), calendar(TEAM)],
    selected: [WORK, TEAM],
  };
  return {
    ...actual,
    calendarServiceClient: {
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
      events: (...args: unknown[]) => events(...args) as unknown,
    },
  };
});

const { CalendarServiceError } = await import("./client");
const { useGoogleEvents } = await import("./use-calendar-service");

describe("events of the selected calendars", () => {
  it("keeps the calendars that could be read when one cannot, and says so", async () => {
    events.mockImplementation((id: string) =>
      id === TEAM
        ? Promise.reject(new CalendarServiceError("rate_limited"))
        : Promise.resolve({ events: [event(id)], omitted: 2 }),
    );
    const { result } = renderHook(() => useGoogleEvents(range));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.events.map(({ calendar_id }) => calendar_id)).toEqual(
      [WORK],
    );
    expect(result.current.omitted).toBe(2);
    expect(result.current.failure).toBe("rate_limited");
  });

  it("reports no failure when every calendar is read", async () => {
    events.mockImplementation((id: string) =>
      Promise.resolve({ events: [event(id)], omitted: 0 }),
    );
    const { result } = renderHook(() => useGoogleEvents(range));
    await waitFor(() => expect(result.current.events).toHaveLength(2));
    expect(result.current.failure).toBeNull();
  });

  it("calls a failure it cannot name unavailable", async () => {
    events.mockRejectedValue(new TypeError("network"));
    const { result } = renderHook(() => useGoogleEvents(range));
    await waitFor(() => expect(result.current.failure).toBe("unavailable"));
    expect(result.current.events).toEqual([]);
  });
});

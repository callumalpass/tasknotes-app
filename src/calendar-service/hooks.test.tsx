import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarSnapshot } from "./client";
import { useCalendarLabEvents } from "./hooks";

const fake = vi.hoisted(() => ({
  state: {} as CalendarSnapshot,
  listeners: new Set<() => void>(),
  events: vi.fn(),
}));
vi.mock("./client", () => ({
  calendarLabClient: {
    getSnapshot: () => fake.state,
    subscribe: (listener: () => void) => {
      fake.listeners.add(listener);
      return () => fake.listeners.delete(listener);
    },
    events: fake.events,
  },
}));
const start = new Date("2026-09-01T00:00:00Z");
const end = new Date("2026-09-30T23:59:59.999Z");
function update(state: Partial<CalendarSnapshot>) {
  act(() => {
    fake.state = { ...fake.state, ...state };
    fake.listeners.forEach((listener) => listener());
  });
}
beforeEach(() => {
  fake.events.mockReset();
  fake.listeners.clear();
  fake.state = {
    signedIn: true,
    busy: false,
    message: "",
    calendars: [],
    selected: ["calendar"],
    connection: null,
  };
});
describe("external calendar render authority", () => {
  it("passes an exclusive end and immediately hides old events on range changes", async () => {
    fake.events.mockResolvedValue([{ id: "old" }]);
    const { result, rerender } = renderHook(
      ({ first }) => useCalendarLabEvents(first, end),
      { initialProps: { first: start } },
    );
    await waitFor(() => expect(result.current.events).toEqual([{ id: "old" }]));
    expect(fake.events.mock.calls[0]?.[2]).toBe("2026-10-01T00:00:00.000Z");
    fake.events.mockReturnValue(new Promise(() => {}));
    rerender({ first: new Date("2026-09-02T00:00:00Z") });
    expect(result.current.events).toEqual([]);
    expect(result.current.loading).toBe(true);
  });
  it("aborts and hides results when the session or selection changes", async () => {
    fake.events.mockResolvedValue([{ id: "old" }]);
    const { result } = renderHook(() => useCalendarLabEvents(start, end));
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    const signal = fake.events.mock.calls[0]?.[3] as AbortSignal;
    update({ signedIn: false, selected: [] });
    expect(signal.aborted).toBe(true);
    expect(result.current.events).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
  it("never releases a delayed result after disconnect", async () => {
    let resolve!: (value: unknown[]) => void;
    fake.events.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result } = renderHook(() => useCalendarLabEvents(start, end));
    update({ selected: [] });
    await act(async () => resolve([{ id: "stale" }]));
    expect(result.current.events).toEqual([]);
  });
  it("contains service failures and never displays provider error text", async () => {
    fake.events.mockRejectedValue(new Error("sensitive provider content"));
    const { result } = renderHook(() => useCalendarLabEvents(start, end));
    await waitFor(() =>
      expect(result.current.error).toContain("could not be loaded"),
    );
    expect(result.current.error).not.toContain("sensitive");
    expect(result.current.events).toEqual([]);
  });
});

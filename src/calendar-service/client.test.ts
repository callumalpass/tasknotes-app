import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CalendarLabClient,
  isCalendarLabEnabled,
  LAB_APP_ORIGIN,
  LAB_SERVICE_ORIGIN,
} from "./client";

const calendarId = "10000000-0000-4000-8000-000000000001";
const connectionId = "20000000-0000-4000-8000-000000000001";
const eventId = "30000000-0000-8000-8000-000000000001";
const calendar = {
  id: calendarId,
  connection_id: connectionId,
  name: "[test] Calendar",
  is_primary: true,
};
const event = {
  id: eventId,
  calendar_id: calendarId,
  title: "[test] Event",
  status: "confirmed",
  start: { kind: "date", date: "2026-09-08" },
  end: { kind: "date", date: "2026-09-09" },
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
const range = ["2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z"] as const;
let popup: {
  opener: unknown;
  closed: boolean;
  location: { replace: ReturnType<typeof vi.fn> };
  close: ReturnType<typeof vi.fn>;
};
function fixture() {
  const transport = vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/start"))
      return json({
        transaction_id: "a".repeat(43),
        polling_secret: "b".repeat(43),
        authorization_url:
          "https://accounts.google.com/o/oauth2/v2/auth?state=test",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    if (path.endsWith("/status")) return json({ status: "authorized" });
    if (path.endsWith("/redeem"))
      return json({
        session: {
          credential: "test-credential".repeat(4),
          session_id: "a".repeat(22),
        },
      });
    if (path === "/v1/connections")
      return json({ connections: [{ id: connectionId, status: "active" }] });
    if (path === "/v1/calendars") return json({ calendars: [calendar] });
    return json({ events: [event], next_cursor: null });
  });
  return { transport, client: new CalendarLabClient(transport) };
}
async function signIn(client: CalendarLabClient) {
  const pending = client.authorize(false);
  // Crypto digest is a real asynchronous operation, not controlled by fake timers.
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalled(), {
    interval: 10,
  });
  await vi.advanceTimersByTimeAsync(1600);
  await pending;
  expect(client.getSnapshot().signedIn).toBe(true);
}
beforeEach(() => {
  vi.useFakeTimers();
  popup = {
    opener: {},
    closed: false,
    location: { replace: vi.fn() },
    close: vi.fn(),
  };
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LAB calendar client", () => {
  it("calls the default browser transport with the global receiver", async () => {
    const { transport } = fixture();
    const nativeFetch = vi.fn(function (
      this: unknown,
      ...args: Parameters<typeof fetch>
    ) {
      if (this !== globalThis)
        return Promise.reject(new TypeError("Illegal invocation"));
      return transport(...args);
    });
    vi.stubGlobal("fetch", nativeFetch);
    const client = new CalendarLabClient();
    await signIn(client);
    expect(nativeFetch).toHaveBeenCalled();
    expect(client.getSnapshot().calendars).toEqual([calendar]);
  });
  it("requires both the explicit build flag and exact LAB origin", () => {
    expect(isCalendarLabEnabled("1", LAB_APP_ORIGIN)).toBe(true);
    for (const origin of [
      "https://app.tasknotes.dev",
      "http://localhost:5173",
      `${LAB_APP_ORIGIN}.evil.example`,
      "null",
    ])
      expect(isCalendarLabEnabled("1", origin)).toBe(false);
    expect(isCalendarLabEnabled(undefined, LAB_APP_ORIGIN)).toBe(false);
  });
  it("owns PKCE/session capabilities without exposing them in snapshots or browser storage", async () => {
    const { client, transport } = fixture();
    const store = vi.spyOn(Storage.prototype, "setItem");
    await signIn(client);
    expect(popup.opener).toBeNull();
    expect(popup.close).toHaveBeenCalled();
    const start = JSON.parse(String(transport.mock.calls[0]![1]!.body));
    expect(start.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const redeem = transport.mock.calls.find(([url]) =>
      String(url).endsWith("/redeem"),
    )!;
    expect(JSON.parse(String(redeem[1]!.body)).code_verifier).not.toBe(
      start.code_challenge,
    );
    expect(JSON.stringify(client.getSnapshot())).not.toContain(
      "test-credential",
    );
    expect(store).not.toHaveBeenCalled();
    for (const [url, init] of transport.mock.calls) {
      expect(String(url).startsWith(LAB_SERVICE_ORIGIN)).toBe(true);
      expect(init?.credentials).toBe("omit");
      expect(init?.redirect).toBe("error");
    }
  });
  it("handles blocked popups without starting a transaction", async () => {
    vi.mocked(window.open).mockReturnValue(null);
    const { client, transport } = fixture();
    await client.authorize(false);
    expect(transport).not.toHaveBeenCalled();
    expect(client.getSnapshot().message).toContain("popups");
  });
  it("rejects provider URL substitution before navigation", async () => {
    const { client, transport } = fixture();
    transport.mockResolvedValueOnce(
      json({
        transaction_id: "a".repeat(43),
        polling_secret: "b".repeat(43),
        authorization_url: "https://evil.example/",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    await client.authorize(false);
    expect(popup.location.replace).not.toHaveBeenCalled();
    expect(client.getSnapshot().signedIn).toBe(false);
    expect(popup.close).toHaveBeenCalled();
  });
  it("maps all-day events to immutable namespaced overlays", async () => {
    const { client } = fixture();
    await signIn(client);
    const events = await client.events(
      calendarId,
      ...range,
      new AbortController().signal,
    );
    expect(events[0]).toMatchObject({
      id: `external:${calendarId}:${eventId}`,
      start: "2026-09-08",
      end: "2026-09-09",
      allDay: true,
      editable: false,
      startEditable: false,
      durationEditable: false,
    });
    expect(events[0]?.extendedProps).not.toHaveProperty("metadata");
  });
  it("retains timed offsets and ignores tombstones", async () => {
    const { client, transport } = fixture();
    await signIn(client);
    transport.mockResolvedValueOnce(
      json({
        events: [
          {
            ...event,
            start: {
              kind: "date_time",
              date_time: "2026-09-08T12:00:00+10:00",
            },
            end: { kind: "date_time", date_time: "2026-09-08T13:00:00+10:00" },
          },
        ],
        next_cursor: null,
      }),
    );
    expect(
      (
        await client.events(calendarId, ...range, new AbortController().signal)
      )[0],
    ).toMatchObject({ allDay: false, start: "2026-09-08T12:00:00+10:00" });
    transport.mockResolvedValueOnce(
      json({
        events: [{ ...event, status: "cancelled", start: null, end: null }],
        next_cursor: null,
      }),
    );
    expect(
      await client.events(calendarId, ...range, new AbortController().signal),
    ).toEqual([]);
  });
  it("keeps the exact range across pages and rejects repeated cursors", async () => {
    const { client, transport } = fixture();
    await signIn(client);
    transport.mockImplementation(async () =>
      json({ events: [event], next_cursor: "cursor".repeat(4) }),
    );
    await expect(
      client.events(calendarId, ...range, new AbortController().signal),
    ).rejects.toThrow("pagination");
    const urls = transport.mock.calls
      .filter(([url]) => String(url).includes("/events?"))
      .map(([url]) => new URL(String(url)));
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url.searchParams.get("start")).toBe(range[0]);
      expect(url.searchParams.get("end")).toBe(range[1]);
    }
  });
  it("rejects unselected calendars and oversized ranges before requesting", async () => {
    const { client, transport } = fixture();
    await signIn(client);
    transport.mockClear();
    expect(
      await client.events(connectionId, ...range, new AbortController().signal),
    ).toEqual([]);
    await expect(
      client.events(
        calendarId,
        range[0],
        "2027-01-01T00:00:00Z",
        new AbortController().signal,
      ),
    ).rejects.toThrow("93 days");
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects cross-calendar and malformed event data", async () => {
    const { client, transport } = fixture();
    await signIn(client);
    transport.mockResolvedValueOnce(
      json({
        events: [{ ...event, calendar_id: connectionId }],
        next_cursor: null,
      }),
    );
    await expect(
      client.events(calendarId, ...range, new AbortController().signal),
    ).rejects.toThrow();
    transport.mockResolvedValueOnce(
      json({ events: [{ ...event, end: event.start }], next_cursor: null }),
    );
    await expect(
      client.events(calendarId, ...range, new AbortController().signal),
    ).rejects.toThrow();
  });
  it("clears local authority on 401", async () => {
    const { client, transport } = fixture();
    await signIn(client);
    transport.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(
      client.events(calendarId, ...range, new AbortController().signal),
    ).rejects.toThrow("expired");
    expect(client.getSnapshot()).toMatchObject({
      signedIn: false,
      calendars: [],
      selected: [],
    });
  });
  it("fences a delayed response after forgetting the session", async () => {
    const { client, transport } = fixture();
    await signIn(client);
    let resolve!: (response: Response) => void;
    transport.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = client.events(
      calendarId,
      ...range,
      new AbortController().signal,
    );
    const assertion = expect(pending).rejects.toThrow("changed");
    client.forget();
    resolve(json({ events: [event], next_cursor: null }));
    await assertion;
    expect(client.getSnapshot().signedIn).toBe(false);
  });
  it("uses empty DELETE bodies and clears calendars on disconnect", async () => {
    const { client, transport } = fixture();
    await signIn(client);
    transport.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await client.disconnect();
    expect(transport.mock.lastCall?.[1]).toMatchObject({
      method: "DELETE",
      body: undefined,
    });
    expect(client.getSnapshot()).toMatchObject({
      connection: null,
      calendars: [],
      selected: [],
      signedIn: true,
    });
  });
  it("revokes the current device on sign-out", async () => {
    const { client, transport } = fixture();
    await signIn(client);
    transport.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await client.signOut();
    expect(String(transport.mock.lastCall?.[0])).toContain(
      `/v1/devices/${"a".repeat(22)}`,
    );
    expect(client.getSnapshot().signedIn).toBe(false);
  });
});

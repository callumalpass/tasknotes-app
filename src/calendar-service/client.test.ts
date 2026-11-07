// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CalendarServiceClient,
  CalendarServiceError,
  type GoogleEvent,
} from "./client";
import type { CalendarServiceHost } from "./host";

const ORIGIN = "https://calendar.test";
const CALENDAR = "6f0e9a52-3a55-4c5e-9d1c-3d8c6d6c3f11";
const OTHER_CALENDAR = "7a1e9a52-3a55-4c5e-9d1c-3d8c6d6c3f22";
const CONNECTION = "8b2e9a52-3a55-4c5e-9d1c-3d8c6d6c3f33";

const event = (id: string): GoogleEvent => ({
  status: "confirmed",
  id: `e1_${id}`,
  etag: `"${id}"`,
  calendar_id: CALENDAR,
  title: id,
  description: null,
  location: null,
  recurrence: null,
  start: { kind: "date", date: "2026-11-09" },
  end: { kind: "date", date: "2026-11-10" },
});

interface Call {
  path: string;
  method: string;
  headers: Record<string, string>;
  credentials?: RequestCredentials;
  body?: Record<string, unknown>;
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

/** Replays `/v1` responses by "METHOD path" and records every request. */
function harness(
  handlers: Record<string, (call: Call) => [number, unknown?]>,
  storage = memoryStorage(),
  host?: CalendarServiceHost,
) {
  const calls: Call[] = [];
  const transport = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const call: Call = {
        path: url.pathname + url.search,
        method: init?.method ?? "GET",
        headers: init?.headers as Record<string, string>,
        credentials: init?.credentials,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const handler = handlers[`${call.method} ${url.pathname}`];
      if (!handler) throw new Error(`Unexpected ${call.method} ${call.path}`);
      const [status, body] = handler(call);
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      });
    },
  ) as unknown as typeof fetch;
  return {
    calls,
    client: new CalendarServiceClient(ORIGIN, transport, storage, host),
    storage,
  };
}

const signInRoutes = {
  "POST /v1/sign-in/start": (): [number, unknown] => [
    201,
    {
      transaction_id: "tx",
      polling_secret: "polling-secret",
      authorization_url: "https://accounts.google.com/o/oauth2/v2/auth?x=1",
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    },
  ],
  "POST /v1/sign-in/tx/status": (): [number, unknown] => [
    200,
    { status: "authorized" },
  ],
  "POST /v1/sign-in/tx/redeem": (): [number, unknown] => [
    200,
    { session: { session_id: "session-1" } },
  ],
  "GET /v1/connections": (): [number, unknown] => [
    200,
    { connections: [{ id: CONNECTION, status: "active" }] },
  ],
  "GET /v1/calendars": (): [number, unknown] => [
    200,
    {
      calendars: [
        { id: CALENDAR, name: "Me", can_write: true, is_primary: true },
        {
          id: OTHER_CALENDAR,
          name: "Team",
          can_write: false,
          is_primary: false,
        },
      ],
    },
  ],
};

async function signIn(client: CalendarServiceClient) {
  const finished = client.signIn();
  await vi.waitFor(() => expect(client.getSnapshot().awaitingCode).toBe(true));
  client.submitCode(" abcd2345 ");
  await finished;
}

describe("CalendarServiceClient", () => {
  let popup: {
    opener: unknown;
    close: ReturnType<typeof vi.fn>;
    location: { replace: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    popup = {
      opener: window,
      close: vi.fn(),
      location: { replace: vi.fn() },
    };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: () => void,
    ) => realSetTimeout(callback, 0)) as unknown as typeof setTimeout);
  });
  afterEach(() => vi.restoreAllMocks());

  it("signs in with PKCE and the confirmation code, then finds calendars", async () => {
    const { client, calls, storage } = harness(signInRoutes);
    await signIn(client);

    expect(popup.opener).toBeNull();
    expect(popup.location.replace).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth?x=1",
    );
    expect(popup.close).not.toHaveBeenCalled();
    const redeem = calls.find(({ path }) => path.endsWith("/redeem"))!;
    expect(redeem.body).toMatchObject({
      polling_secret: "polling-secret",
      confirmation_code: "ABCD2345",
    });
    const start = calls.find(({ path }) => path.endsWith("/start"))!;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(String(redeem.body!.code_verifier)),
    );
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    expect(start.body!.code_challenge).toBe(challenge);
    expect(calls.at(-1)!.credentials).toBe("include");
    expect(calls.at(-1)!.headers.Authorization).toBeUndefined();
    expect(client.getSnapshot()).toMatchObject({
      sessionId: "session-1",
      busy: false,
      selected: [CALENDAR],
    });
    expect(storage.getItem("tasknotes:google-calendars:v1")).toBeNull();
  });

  it("refuses a popup destination other than Google's page", async () => {
    const { client } = harness({
      ...signInRoutes,
      "POST /v1/sign-in/start": () => [
        201,
        {
          transaction_id: "tx",
          polling_secret: "polling-secret",
          authorization_url:
            "https://accounts.google.com.evil.test/o/oauth2/v2/auth",
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        },
      ],
    });
    await client.signIn();
    expect(popup.location.replace).not.toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalled();
    expect(client.getSnapshot().failure).toBe("invalid_authorization");
  });

  it("names a rejected code and does not sign in", async () => {
    const { client } = harness({
      ...signInRoutes,
      "POST /v1/sign-in/tx/redeem": () => [400],
    });
    await signIn(client);
    expect(client.getSnapshot()).toMatchObject({
      sessionId: null,
      busy: false,
      failure: "code_rejected",
    });
  });

  it("does not sign in when the person stops waiting at the code", async () => {
    const { client, calls } = harness(signInRoutes);
    const finished = client.signIn();
    await vi.waitFor(() =>
      expect(client.getSnapshot().awaitingCode).toBe(true),
    );
    client.cancelAuthorization();
    await finished;
    expect(calls.some(({ path }) => path.endsWith("/redeem"))).toBe(false);
    expect(client.getSnapshot()).toMatchObject({
      busy: false,
      awaitingCode: false,
      failure: null,
    });
    expect(popup.close).not.toHaveBeenCalled();
  });

  it("stopping a connect keeps the existing session", async () => {
    const { client } = harness({
      ...signInRoutes,
      "POST /v1/connections/google/start": () => [
        201,
        {
          transaction_id: "connect",
          polling_secret: "polling-secret",
          authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        },
      ],
      "POST /v1/connections/google/connect/status": () => [
        200,
        { status: "pending" },
      ],
    });
    await signIn(client);
    const finished = client.connect();
    await vi.waitFor(() =>
      expect(popup.location.replace).toHaveBeenCalledTimes(2),
    );
    client.cancelAuthorization();
    await finished;
    expect(client.getSnapshot()).toMatchObject({
      sessionId: "session-1",
      busy: false,
    });
  });

  it("reports a stalled request instead of treating it as a cancel", async () => {
    const { client } = harness({
      "GET /v1/connections": () => {
        throw new DOMException("Timed out", "TimeoutError");
      },
    });
    await client.refresh();
    expect(client.getSnapshot()).toMatchObject({
      busy: false,
      failure: "unavailable",
    });
  });

  it("reports a blocked popup without starting a transaction", async () => {
    vi.mocked(window.open).mockReturnValue(null);
    const { client, calls } = harness(signInRoutes);
    await client.signIn();
    expect(calls).toEqual([]);
    expect(client.getSnapshot().failure).toBe("popup_blocked");
  });

  it("restores a session after reload, without a new sign-in", async () => {
    const storage = memoryStorage();
    const first = harness(signInRoutes, storage);
    await signIn(first.client);
    const { client, calls } = harness(
      {
        ...signInRoutes,
        "GET /v1/session": () => [200, { session_id: "session-1" }],
      },
      storage,
    );
    expect(client.getSnapshot().sessionId).toBeNull();
    await client.restore();
    expect(client.getSnapshot()).toMatchObject({
      sessionId: "session-1",
      failure: null,
    });
    expect(client.getSnapshot().calendars).not.toEqual([]);
    expect(calls.map((call) => call.path)).toEqual([
      "/v1/session",
      "/v1/connections",
      "/v1/calendars",
    ]);
  });

  it("never calls the service on load for someone who has not signed in", async () => {
    const { client, calls } = harness({});
    await client.restore();
    expect(calls).toEqual([]);
  });

  it("returns quietly to signed out when the restored session has ended", async () => {
    const storage = memoryStorage();
    await signIn(harness(signInRoutes, storage).client);
    const { client, calls } = harness(
      { "GET /v1/session": () => [401] },
      storage,
    );
    await client.restore();
    expect(client.getSnapshot()).toMatchObject({
      sessionId: null,
      busy: false,
      failure: null,
    });
    await client.restore();
    expect(calls).toHaveLength(1);
  });

  it("keeps the session for the next load when the service is unavailable", async () => {
    const storage = memoryStorage();
    await signIn(harness(signInRoutes, storage).client);
    const down = harness({ "GET /v1/session": () => [503] }, storage);
    await down.client.restore();
    expect(down.client.getSnapshot()).toMatchObject({
      sessionId: null,
      failure: "unavailable",
    });
    const { client } = harness(
      {
        ...signInRoutes,
        "GET /v1/session": () => [200, { session_id: "session-1" }],
      },
      storage,
    );
    await client.restore();
    expect(client.getSnapshot().sessionId).toBe("session-1");
  });

  it("forgets everything on a 401 and does not restore afterwards", async () => {
    const { client, calls } = harness({
      ...signInRoutes,
      [`GET /v1/calendars/${CALENDAR}/events`]: () => [401],
    });
    await signIn(client);
    await expect(
      client.events(
        CALENDAR,
        new Date("2026-11-01T00:00:00Z"),
        new Date("2026-11-08T00:00:00Z"),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ failure: "session_expired" });
    expect(client.getSnapshot()).toMatchObject({
      sessionId: null,
      calendars: [],
    });
    const count = calls.length;
    await client.restore();
    expect(calls).toHaveLength(count);
  });

  it("a late response from a forgotten session cannot change state", async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const { client } = harness(signInRoutes);
    await signIn(client);
    const transport = vi.fn(async () => {
      await held;
      return new Response(JSON.stringify({ connections: [] }));
    }) as unknown as typeof fetch;
    Object.defineProperty(client, "transport", { value: transport });
    const refreshed = client.refresh();
    client.forget();
    release();
    await refreshed;
    expect(client.getSnapshot()).toMatchObject({
      sessionId: null,
      busy: false,
      failure: null,
      connection: null,
    });
  });

  it("splits long ranges, repeats the range with each cursor and removes duplicates", async () => {
    const queries: URLSearchParams[] = [];
    const { client } = harness({
      [`GET /v1/calendars/${CALENDAR}/events`]: ({ path }) => {
        const query = new URL(path, ORIGIN).searchParams;
        queries.push(query);
        return [
          200,
          queries.length === 1
            ? {
                events: [event("a")],
                omitted_count: 1,
                next_cursor: "page-two-cursor",
              }
            : {
                events: [event("a"), event("b")],
                omitted_count: 0,
                next_cursor: null,
              },
        ];
      },
    });
    const result = await client.events(
      CALENDAR,
      new Date("2026-01-01T00:00:00Z"),
      new Date("2027-01-01T00:00:00Z"),
      new AbortController().signal,
    );
    expect(result.events.map(({ id }) => id)).toEqual(["e1_a", "e1_b"]);
    expect(result.omitted).toBe(1);
    expect(queries[1]!.get("cursor")).toBe("page-two-cursor");
    expect(queries[1]!.get("start")).toBe(queries[0]!.get("start"));
    expect(queries[1]!.get("end")).toBe(queries[0]!.get("end"));
    for (const query of queries) {
      const span =
        Date.parse(query.get("end")!) - Date.parse(query.get("start")!);
      expect(span).toBeLessThanOrEqual(93 * 86_400_000);
    }
    expect(queries.at(-1)!.get("end")).toBe("2027-01-01T00:00:00.000Z");
  });

  it("drops a cancelled event from a range", async () => {
    const { client } = harness({
      [`GET /v1/calendars/${CALENDAR}/events`]: () => [
        200,
        {
          events: [event("a"), { status: "cancelled", id: "e1_a" }],
          omitted_count: 0,
          next_cursor: null,
        },
      ],
    });
    const { events } = await client.events(
      CALENDAR,
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-11-08T00:00:00Z"),
      new AbortController().signal,
    );
    expect(events).toEqual([]);
  });

  it("fails visibly on endless pagination and malformed events", async () => {
    const range = [
      CALENDAR,
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-11-08T00:00:00Z"),
      new AbortController().signal,
    ] as const;
    const endless = harness({
      [`GET /v1/calendars/${CALENDAR}/events`]: () => [
        200,
        { events: [], omitted_count: 0, next_cursor: "again" },
      ],
    });
    await expect(endless.client.events(...range)).rejects.toMatchObject({
      failure: "pagination",
    });
    const malformed = harness({
      [`GET /v1/calendars/${CALENDAR}/events`]: () => [
        200,
        {
          events: [{ ...event("a"), etag: null }],
          omitted_count: 0,
          next_cursor: null,
        },
      ],
    });
    await expect(malformed.client.events(...range)).rejects.toThrow();
  });

  it("writes with the idempotency key and the event's etag", async () => {
    const path = `/v1/calendars/${CALENDAR}/events`;
    const { client, calls } = harness({
      [`POST ${path}`]: () => [201, event("new")],
      [`PATCH ${path}/e1_a`]: () => [200, event("a")],
      [`DELETE ${path}/e1_a`]: () => [204],
    });
    const { start, end } = event("a");
    await client.createEvent(CALENDAR, { start, end }, "the-key");
    await client.updateEvent(event("a"), { title: "New" });
    await client.deleteEvent(event("a"));
    expect(calls[0]!.body).toMatchObject({ idempotency_key: "the-key" });
    expect(calls[1]!.headers["If-Match"]).toBe('"a"');
    expect(calls[1]!.body).toEqual({ title: "New" });
    expect(calls[2]!.headers["If-Match"]).toBe('"a"');
  });

  it("names a stale etag as a conflict", async () => {
    const { client } = harness({
      [`PATCH /v1/calendars/${CALENDAR}/events/e1_a`]: () => [409],
    });
    const failure = await client
      .updateEvent(event("a"), { title: "New" })
      .catch((reason: unknown) => reason);
    expect(failure).toBeInstanceOf(CalendarServiceError);
    expect(failure).toMatchObject({ failure: "conflict" });
  });

  it("keeps a chosen selection across sessions and clears it on disconnect", async () => {
    const storage = memoryStorage();
    const { client } = harness(
      {
        ...signInRoutes,
        [`DELETE /v1/connections/${CONNECTION}`]: () => [204],
      },
      storage,
    );
    await signIn(client);
    client.setSelected([OTHER_CALENDAR]);
    client.forget();
    await signIn(client);
    expect(client.getSnapshot().selected).toEqual([OTHER_CALENDAR]);
    await client.disconnect();
    expect(client.getSnapshot()).toMatchObject({
      connection: null,
      calendars: [],
      selected: [],
    });
    expect(storage.getItem("tasknotes:google-calendars:v1")).toBeNull();
  });
});

describe("CalendarServiceClient on a native host", () => {
  const CREDENTIAL = "v1.native-credential";
  const SIGNED_IN = "tasknotes:google-calendar-signed-in:v1";
  const nativeRoutes = {
    ...signInRoutes,
    "POST /v1/sign-in/tx/redeem": (): [number, unknown] => [
      200,
      { session: { session_id: "session-1", credential: CREDENTIAL } },
    ],
  };

  function nativeHost(stored: string | null = null) {
    const credentials = {
      value: stored,
      load: vi.fn(async () => credentials.value),
      save: vi.fn(async (value: string) => {
        credentials.value = value;
      }),
      clear: vi.fn(async () => {
        credentials.value = null;
      }),
    };
    const authorizationWindow = { show: vi.fn(), close: vi.fn() };
    const host: CalendarServiceHost = {
      clientKind: "ios",
      deviceName: "TaskNotes iOS",
      credentials,
      openWindow: () => authorizationWindow,
    };
    return { host, credentials, authorizationWindow };
  }

  it("signs in through the system browser and sends only a bearer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const open = vi.spyOn(window, "open");
      const storage = memoryStorage();
      const { host, credentials, authorizationWindow } = nativeHost();
      const { client, calls } = harness(nativeRoutes, storage, host);
      const signIn = client.signIn();
      await vi.waitFor(() =>
        expect(client.getSnapshot().awaitingCode).toBe(true),
      );
      client.submitCode("abcd1234");
      await signIn;

      expect(open).not.toHaveBeenCalled();
      expect(authorizationWindow.show).toHaveBeenCalledWith(
        "https://accounts.google.com/o/oauth2/v2/auth?x=1",
      );
      expect(authorizationWindow.close).toHaveBeenCalled();
      expect(calls[0]!.body).toMatchObject({
        client_kind: "ios",
        device_name: "TaskNotes iOS",
      });
      expect(credentials.save).toHaveBeenCalledWith(CREDENTIAL);
      expect(storage.getItem(SIGNED_IN)).toBe("1");
      expect(JSON.stringify(client.getSnapshot())).not.toContain(CREDENTIAL);
      const connections = calls.find((call) => call.path === "/v1/connections");
      expect(connections!.headers.Authorization).toBe(`Bearer ${CREDENTIAL}`);
      expect(calls.every((call) => call.credentials === "omit")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps waiting through a stalled poll and leaves the browser open", async () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      const { host, authorizationWindow } = nativeHost();
      const failures = [
        new DOMException("Timed out", "TimeoutError"),
        new TypeError("Failed to fetch"),
      ];
      const { client, calls } = harness(
        {
          ...nativeRoutes,
          "POST /v1/sign-in/tx/status": () => {
            const failure = failures.shift();
            if (failure) throw failure;
            return [200, { status: "authorized" }];
          },
        },
        storage,
        host,
      );
      const signIn = client.signIn();
      await vi.waitFor(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
        expect(client.getSnapshot().awaitingCode).toBe(true);
      });

      expect(client.getSnapshot().failure).toBeNull();
      expect(authorizationWindow.close).not.toHaveBeenCalled();
      expect(calls.filter((call) => call.path.endsWith("/status")).length).toBe(
        3,
      );
      client.submitCode("abcd1234");
      await signIn;
      expect(client.getSnapshot().sessionId).toBe("session-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling once the transaction's lifetime has passed", async () => {
    vi.useFakeTimers();
    try {
      const { client } = harness(
        {
          ...nativeRoutes,
          "POST /v1/sign-in/tx/status": () => {
            throw new TypeError("Failed to fetch");
          },
        },
        memoryStorage(),
        nativeHost().host,
      );
      const signIn = client.signIn();
      await vi.waitFor(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
        expect(client.getSnapshot().failure).toBe("authorization_expired");
      });
      await signIn;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait out a service refusal", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { client, calls } = harness(
        {
          ...nativeRoutes,
          "POST /v1/sign-in/tx/status": () => [400],
        },
        memoryStorage(),
        nativeHost().host,
      );
      await client.signIn();
      expect(client.getSnapshot().failure).toBe("invalid_request");
      expect(calls.filter((call) => call.path.endsWith("/status")).length).toBe(
        1,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores from the sealed store with its bearer", async () => {
    const storage = memoryStorage();
    storage.setItem(SIGNED_IN, "1");
    const { host } = nativeHost(CREDENTIAL);
    const { client, calls } = harness(
      {
        ...signInRoutes,
        "GET /v1/session": () => [200, { session_id: "session-1" }],
      },
      storage,
      host,
    );
    await client.restore();

    expect(client.getSnapshot().sessionId).toBe("session-1");
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${CREDENTIAL}`);
  });

  it("signs out without a request when the store was evicted", async () => {
    const storage = memoryStorage();
    storage.setItem(SIGNED_IN, "1");
    const { client, calls } = harness({}, storage, nativeHost().host);
    await client.restore();

    expect(calls).toEqual([]);
    expect(storage.getItem(SIGNED_IN)).toBeNull();
    expect(client.getSnapshot().sessionId).toBeNull();
  });

  it("wipes the sealed credential when the session has ended", async () => {
    const storage = memoryStorage();
    storage.setItem(SIGNED_IN, "1");
    const { host, credentials } = nativeHost(CREDENTIAL);
    const { client } = harness(
      { "GET /v1/session": () => [401] },
      storage,
      host,
    );
    await client.restore();

    expect(credentials.clear).toHaveBeenCalled();
    expect(credentials.value).toBeNull();
    expect(client.getSnapshot().failure).toBeNull();
  });
});

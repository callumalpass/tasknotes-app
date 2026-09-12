import { z } from "zod";
import type { EventInput } from "@fullcalendar/core";

export const LAB_APP_ORIGIN = "https://lab.tasknotes-app.pages.dev";
export const LAB_SERVICE_ORIGIN =
  "https://tasknotes-calendar-lab.callumalpass.workers.dev";
export function isCalendarLabEnabled(flag: unknown, origin: string): boolean {
  return flag === "1" && origin === LAB_APP_ORIGIN;
}
const id = z.uuid();
const capability = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const calendarSchema = z.object({
  id,
  connection_id: id,
  name: z.string().max(1000),
  is_primary: z.boolean(),
});
export type Calendar = z.infer<typeof calendarSchema>;
const connectionSchema = z.object({
  id,
  status: z.enum(["active", "reconnect_required"]),
});
const boundary = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("date"), date: z.iso.date() }),
  z.object({
    kind: z.literal("date_time"),
    date_time: z.iso.datetime({ offset: true }),
  }),
]);
const eventSchema = z.object({
  id,
  calendar_id: id,
  title: z.string().max(2000).nullable(),
  status: z.enum(["confirmed", "tentative", "cancelled"]),
  start: boundary.nullable(),
  end: boundary.nullable(),
});
const pageSchema = z.object({
  events: z.array(eventSchema).max(250),
  next_cursor: z.string().min(16).max(2048).nullable(),
});
const startSchema = z.object({
  transaction_id: capability,
  polling_secret: capability,
  authorization_url: z.url().max(4096),
  expires_at: z.iso.datetime({ offset: true }),
});
const statusSchema = z.object({
  status: z.enum(["pending", "authorized", "failed", "expired"]),
});
const sessionSchema = z.object({
  session: z.object({
    credential: z.string().min(32).max(256),
    session_id: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
});
export interface CalendarSnapshot {
  signedIn: boolean;
  busy: boolean;
  message: string;
  calendars: Calendar[];
  selected: string[];
  connection: z.infer<typeof connectionSchema> | null;
}
const initial = (): CalendarSnapshot => ({
  signedIn: false,
  busy: false,
  message: "",
  calendars: [],
  selected: [],
  connection: null,
});
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

/** Owns all capabilities in memory. Never put this instance in persisted state. */
export class CalendarLabClient {
  #credential = "";
  #sessionId = "";
  #generation = 0;
  #controller = new AbortController();
  #listeners = new Set<() => void>();
  #snapshot = initial();
  // Native browser fetch requires the global receiver, not this client instance.
  constructor(
    private readonly transport: typeof fetch = (...args) =>
      globalThis.fetch(...args),
  ) {}
  getSnapshot = () => this.#snapshot;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #publish(update: Partial<CalendarSnapshot>) {
    this.#snapshot = { ...this.#snapshot, ...update };
    this.#listeners.forEach((listener) => listener());
  }
  forget = () => {
    this.#generation++;
    this.#controller.abort();
    this.#controller = new AbortController();
    this.#credential = "";
    this.#sessionId = "";
    this.#snapshot = initial();
    this.#listeners.forEach((listener) => listener());
  };
  select = (calendarId: string, selected: boolean) => {
    if (
      !this.#snapshot.calendars.some((calendar) => calendar.id === calendarId)
    )
      return;
    this.#publish({
      selected: selected
        ? [...new Set([...this.#snapshot.selected, calendarId])].slice(0, 5)
        : this.#snapshot.selected.filter((value) => value !== calendarId),
    });
  };
  async #request<T>(
    path: string,
    schema: z.ZodType<T> | null,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
    signal?: AbortSignal,
  ): Promise<T> {
    const generation = this.#generation;
    const response = await this.transport(`${LAB_SERVICE_ORIGIN}${path}`, {
      method,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.any([
        this.#controller.signal,
        AbortSignal.timeout(30_000),
        ...(signal ? [signal] : []),
      ]),
      headers: {
        ...(this.#credential
          ? { Authorization: `Bearer ${this.#credential}` }
          : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (generation !== this.#generation)
      throw new Error("Calendar session changed.");
    if (response.status === 401) {
      this.forget();
      throw new Error("Calendar session expired. Sign in again.");
    }
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? "Calendar service is busy. Try again later."
          : "Calendar request failed. The LAB service may be disabled; try again or reconnect.",
      );
    if (!schema) return undefined as T;
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Invalid calendar response.");
    let text = "";
    let size = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 12 * 1024 * 1024)
          throw new Error("Calendar response is too large.");
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      if (generation !== this.#generation)
        throw new Error("Calendar session changed.");
      const parsed = schema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error("Invalid calendar response.");
      return parsed.data;
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
  async #run(action: () => Promise<void>) {
    if (this.#snapshot.busy) return;
    const generation = this.#generation;
    this.#publish({ busy: true, message: "" });
    try {
      await action();
    } catch {
      if (generation === this.#generation)
        this.#publish({
          message:
            "Calendar operation failed. Retry, reconnect, or check that LAB is enabled.",
        });
    } finally {
      if (generation === this.#generation) this.#publish({ busy: false });
    }
  }
  authorize = (connect: boolean) => {
    if (this.#snapshot.busy || (connect && !this.#credential))
      return Promise.resolve();
    // Open synchronously during the user gesture; sever the opener before navigation.
    const popup = window.open(
      "about:blank",
      "_blank",
      "popup,width=520,height=720",
    );
    if (!popup) {
      this.#publish({ message: "Allow popups to authorize Google Calendar." });
      return Promise.resolve();
    }
    popup.opener = null;
    return this.#run(async () => {
      const generation = this.#generation;
      const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = encode(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(verifier),
          ),
        ),
      );
      const base = connect ? "/v1/connections/google" : "/v1/sign-in";
      try {
        const transaction = await this.#request(`${base}/start`, startSchema, {
          client_kind: "web",
          device_name: "TaskNotes LAB browser",
          code_challenge: challenge,
        });
        const url = new URL(transaction.authorization_url);
        if (
          url.origin !== "https://accounts.google.com" ||
          url.pathname !== "/o/oauth2/v2/auth" ||
          url.username ||
          url.password
        )
          throw new Error("Invalid authorization endpoint.");
        popup.location.replace(url.href);
        const deadline = Math.min(
          Date.parse(transaction.expires_at),
          Date.now() + 10 * 60_000,
        );
        while (Date.now() < deadline && generation === this.#generation) {
          // Do not infer cancellation from popup.closed: Google's COOP policy
          // can sever the window handle while consent is still in progress.
          await new Promise((resolve) => setTimeout(resolve, 1500));
          if (generation !== this.#generation) return;
          const status = await this.#request(
            `${base}/${transaction.transaction_id}/status`,
            statusSchema,
            { polling_secret: transaction.polling_secret },
          );
          if (status.status === "pending") continue;
          if (status.status !== "authorized")
            throw new Error("Authorization failed.");
          const body = {
            polling_secret: transaction.polling_secret,
            code_verifier: verifier,
          };
          if (connect)
            await this.#request(
              `${base}/${transaction.transaction_id}/redeem`,
              z.object({ connection_id: id, status: z.literal("active") }),
              body,
            );
          else {
            const { session } = await this.#request(
              `${base}/${transaction.transaction_id}/redeem`,
              sessionSchema,
              body,
            );
            this.#credential = session.credential;
            this.#sessionId = session.session_id;
            this.#publish({ signedIn: true });
          }
          await this.#discover();
          return;
        }
        throw new Error("Authorization expired.");
      } finally {
        popup.close();
      }
    });
  };
  async #discover() {
    const { connections } = await this.#request(
      "/v1/connections",
      z.object({ connections: z.array(connectionSchema).max(1) }),
    );
    const connection = connections[0] ?? null;
    this.#publish({ connection, calendars: [], selected: [] });
    if (connection?.status !== "active") return;
    const { calendars } = await this.#request(
      "/v1/calendars",
      z.object({ calendars: z.array(calendarSchema).max(250) }),
    );
    this.#publish({
      calendars,
      selected: calendars
        .filter((calendar) => calendar.is_primary)
        .slice(0, 1)
        .map((calendar) => calendar.id),
    });
  }
  refresh = () => this.#run(() => this.#discover());
  disconnect = () =>
    this.#run(async () => {
      const connection = this.#snapshot.connection;
      if (!connection) return;
      this.#publish({ calendars: [], selected: [] });
      await this.#request(
        `/v1/connections/${connection.id}`,
        null,
        undefined,
        "DELETE",
      );
      this.#publish({ connection: null });
    });
  signOut = () =>
    this.#run(async () => {
      await this.#request(
        `/v1/devices/${this.#sessionId}`,
        null,
        undefined,
        "DELETE",
      );
      this.forget();
    });
  deleteAccount = () =>
    this.#run(async () => {
      await this.#request("/v1/account", null, undefined, "DELETE");
      this.forget();
    });
  async events(
    calendarId: string,
    start: string,
    end: string,
    signal: AbortSignal,
  ): Promise<EventInput[]> {
    if (!this.#snapshot.selected.includes(calendarId)) return [];
    const duration = Date.parse(end) - Date.parse(start);
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 93 * 86400_000
    )
      throw new Error("Choose a calendar range of at most 93 days.");
    const events = new Map<string, EventInput>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const query: URLSearchParams = new URLSearchParams({
        start,
        end,
        ...(cursor ? { cursor } : {}),
      });
      const result: z.infer<typeof pageSchema> = await this.#request(
        `/v1/calendars/${id.parse(calendarId)}/events?${query}`,
        pageSchema,
        undefined,
        "GET",
        signal,
      );
      for (const event of result.events) {
        if (event.calendar_id !== calendarId)
          throw new Error("Invalid calendar response.");
        if (event.status === "cancelled") {
          events.delete(event.id);
          continue;
        }
        if (!event.start || !event.end || event.start.kind !== event.end.kind)
          throw new Error("Invalid event interval.");
        const start =
          event.start.kind === "date"
            ? event.start.date
            : event.start.date_time;
        const end =
          event.end.kind === "date" ? event.end.date : event.end.date_time;
        if (!(Date.parse(end) > Date.parse(start)))
          throw new Error("Invalid event interval.");
        events.set(event.id, {
          id: `external:${calendarId}:${event.id}`,
          title: event.title || "Untitled event",
          start,
          end,
          allDay: event.start.kind === "date",
          editable: false,
          startEditable: false,
          durationEditable: false,
          extendedProps: { externalCalendar: true },
          classNames: ["external-calendar-event"],
        });
      }
      cursor = result.next_cursor;
      if (!cursor) return [...events.values()];
      if (cursors.has(cursor)) throw new Error("Invalid calendar pagination.");
      cursors.add(cursor);
    }
    throw new Error("Too many events. Select a shorter period.");
  }
}
export const calendarLabClient =
  typeof window !== "undefined" &&
  isCalendarLabEnabled(
    import.meta.env.VITE_CALENDAR_LAB,
    window.location.origin,
  )
    ? new CalendarLabClient()
    : null;
if (calendarLabClient)
  window.addEventListener("pagehide", calendarLabClient.forget);

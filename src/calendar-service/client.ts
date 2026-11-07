import { z } from "zod";
import { currentHost, webHost, type CalendarServiceHost } from "./host";

/** Builds without an origin run and render none of this. */
const SERVICE_ORIGIN = import.meta.env.VITE_TASKNOTES_CALENDAR_ORIGIN;
const SELECTION_KEY = "tasknotes:google-calendars:v1";
// Holds no credential: it only spares everyone else a service call on load.
const SIGNED_IN_KEY = "tasknotes:google-calendar-signed-in:v1";
const MAX_RANGE_MS = 93 * 86_400_000;
const MAX_PAGES_PER_RANGE = 20;
export const MAX_SELECTED_CALENDARS = 5;

const id = z.uuid();
const eventId = z.string().regex(/^e1_[A-Za-z0-9_-]+$/);
const calendarSchema = z.object({
  id,
  name: z.string(),
  can_write: z.boolean(),
  is_primary: z.boolean(),
});
const connectionSchema = z.object({
  id,
  status: z.enum(["active", "reconnect_required"]),
});
const boundarySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("date"), date: z.iso.date() }),
  z.object({
    kind: z.literal("date_time"),
    date_time: z.iso.datetime({ offset: true }),
    time_zone: z.string().optional(),
  }),
]);
const eventSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("cancelled"), id: eventId }),
  z.object({
    status: z.enum(["confirmed", "tentative"]),
    id: eventId,
    etag: z.string().min(1),
    calendar_id: id,
    title: z.string().nullable(),
    description: z.string().nullable(),
    location: z.string().nullable(),
    recurrence: z.object({ series_id: eventId }).nullable(),
    start: boundarySchema,
    end: boundarySchema,
  }),
]);
const pageSchema = z.object({
  events: z.array(eventSchema),
  omitted_count: z.number().int().min(0),
  next_cursor: z.string().min(1).nullable(),
});
const startSchema = z.object({
  transaction_id: z.string().min(1),
  polling_secret: z.string().min(1),
  authorization_url: z.url(),
  expires_at: z.iso.datetime({ offset: true }),
});
const statusSchema = z.object({
  status: z.enum(["pending", "authorized", "failed", "expired"]),
});
const sessionSchema = z.object({
  session: z.object({
    session_id: z.string().min(1),
  }),
});
const nativeSessionSchema: z.ZodType<{
  session: { session_id: string; credential?: string };
}> = z.object({
  session: z.object({
    session_id: z.string().min(1),
    credential: z.string().min(1),
  }),
});
const currentSessionSchema = z.object({ session_id: z.string().min(1) });

export type GoogleCalendar = z.infer<typeof calendarSchema>;
export type EventBoundary = z.infer<typeof boundarySchema>;
export type GoogleEvent = Exclude<
  z.infer<typeof eventSchema>,
  { status: "cancelled" }
>;
export interface EventFields {
  title?: string;
  description?: string;
  location?: string;
  start?: EventBoundary;
  end?: EventBoundary;
}
export type CalendarServiceFailure =
  | "authorization_failed"
  | "authorization_expired"
  | "code_rejected"
  | "conflict"
  | "invalid_authorization"
  | "invalid_request"
  | "not_found"
  | "pagination"
  | "popup_blocked"
  | "rate_limited"
  | "session_expired"
  | "unavailable";

export class CalendarServiceError extends Error {
  constructor(readonly failure: CalendarServiceFailure) {
    super(failure);
  }
}

export interface CalendarServiceSnapshot {
  sessionId: string | null;
  busy: boolean;
  awaitingCode: boolean;
  failure: CalendarServiceFailure | null;
  connection: z.infer<typeof connectionSchema> | null;
  calendars: GoogleCalendar[];
  selected: string[];
}

function failureForStatus(status: number): CalendarServiceFailure {
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  return status >= 400 && status < 500 ? "invalid_request" : "unavailable";
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function storedSelection(storage: Pick<Storage, "getItem">): string[] | null {
  try {
    return z
      .array(id)
      .parse(JSON.parse(storage.getItem(SELECTION_KEY) ?? "null"));
  } catch {
    return null;
  }
}

/** Google's page is the only place the sign-in popup may be sent. */
function authorizationUrl(value: string): string {
  const url = new URL(value);
  if (
    url.origin !== "https://accounts.google.com" ||
    url.pathname !== "/o/oauth2/v2/auth" ||
    url.username ||
    url.password
  )
    throw new CalendarServiceError("invalid_authorization");
  return url.href;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });
}

/**
 * Owns the polling secret and PKCE verifier in private memory: they never
 * reach React state, browser storage, logs, URLs or mdbase. A web session lives
 * in the service's HttpOnly cookie, which no script here can read; a native one
 * is a bearer credential held here and in the host's sealed store. Google tokens
 * never reach this client.
 */
export class CalendarServiceClient {
  #session = new AbortController();
  #credential: string | null = null;
  #attempt: AbortController | null = null;
  #submitCode: ((code: string) => void) | null = null;
  #listeners = new Set<() => void>();
  #snapshot: CalendarServiceSnapshot;

  constructor(
    private readonly origin: string,
    // Native fetch requires the global receiver, not this instance.
    private readonly transport: typeof fetch = (...args) =>
      globalThis.fetch(...args),
    private readonly storage: Pick<
      Storage,
      "getItem" | "setItem" | "removeItem"
    > = window.localStorage,
    private readonly host: CalendarServiceHost = webHost,
  ) {
    this.#snapshot = this.#signedOut();
  }

  #signedOut(): CalendarServiceSnapshot {
    return {
      sessionId: null,
      busy: false,
      awaitingCode: false,
      failure: null,
      connection: null,
      calendars: [],
      selected: storedSelection(this.storage) ?? [],
    };
  }

  getSnapshot = () => this.#snapshot;

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  #publish(update: Partial<CalendarServiceSnapshot>) {
    this.#snapshot = { ...this.#snapshot, ...update };
    this.#listeners.forEach((listener) => listener());
  }

  /** Drops local authority; the server session stays until it is signed out. */
  forget = () => {
    this.#session.abort();
    this.#session = new AbortController();
    this.storage.removeItem(SIGNED_IN_KEY);
    this.#credential = null;
    void this.host.credentials?.clear();
    this.#snapshot = this.#signedOut();
    this.#listeners.forEach((listener) => listener());
  };

  async #request<T>(
    path: string,
    schema: z.ZodType<T> | null,
    options: {
      method?: string;
      body?: unknown;
      etag?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const session = this.#session;
    const { body, etag, signal } = options;
    const response = await this.transport(`${this.origin}${path}`, {
      method: options.method ?? (body === undefined ? "GET" : "POST"),
      credentials: this.host.credentials ? "omit" : "include",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.any([
        session.signal,
        AbortSignal.timeout(30_000),
        ...(signal ? [signal] : []),
      ]),
      headers: {
        ...(this.#credential
          ? { Authorization: `Bearer ${this.#credential}` }
          : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(etag ? { "If-Match": etag } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    session.signal.throwIfAborted();
    if (response.status === 401) {
      this.forget();
      throw new CalendarServiceError("session_expired");
    }
    if (!response.ok)
      throw new CalendarServiceError(failureForStatus(response.status));
    if (!schema) return undefined as T;
    const value = schema.parse(await response.json());
    session.signal.throwIfAborted();
    return value;
  }

  async #run(action: () => Promise<void>) {
    const session = this.#session;
    this.#publish({ busy: true, failure: null });
    try {
      await action();
    } catch (reason) {
      if (session.signal.aborted || isAbort(reason)) return;
      this.#publish({
        failure:
          reason instanceof CalendarServiceError
            ? reason.failure
            : "unavailable",
      });
    } finally {
      if (!session.signal.aborted) this.#publish({ busy: false });
    }
  }

  /** Resumes the session after a reload; a 401 just signs out. */
  restore = async () => {
    if (!this.storage.getItem(SIGNED_IN_KEY)) return;
    await this.#run(async () => {
      if (this.host.credentials) {
        this.#credential = await this.host.credentials.load();
        if (!this.#credential) {
          this.forget();
          return;
        }
      }
      const { session_id } = await this.#request(
        "/v1/session",
        currentSessionSchema,
      );
      this.#publish({ sessionId: session_id });
      await this.#discover();
    });
  };

  signIn = () => this.#authorize("/v1/sign-in");
  connect = () => this.#authorize("/v1/connections/google");

  #authorize(base: "/v1/sign-in" | "/v1/connections/google") {
    if (this.#snapshot.busy) return Promise.resolve();
    // Open during the user gesture, before any request can lose it.
    const authorizationWindow = this.host.openWindow();
    if (!authorizationWindow) {
      this.#publish({ failure: "popup_blocked" });
      return Promise.resolve();
    }
    const attempt = new AbortController();
    this.#attempt = attempt;
    const { signal } = attempt;
    return this.#run(async () => {
      try {
        const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
        const challenge = base64Url(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(verifier),
            ),
          ),
        );
        const transaction = await this.#request(`${base}/start`, startSchema, {
          body: {
            client_kind: this.host.clientKind,
            device_name: this.host.deviceName,
            code_challenge: challenge,
          },
          signal,
        });
        await authorizationWindow.show(
          authorizationUrl(transaction.authorization_url),
        );
        const path = `${base}/${transaction.transaction_id}`;
        const secret = { polling_secret: transaction.polling_secret };
        // The window's state proves nothing: Google's COOP severs a popup's
        // handle while consent is in progress. The transaction's expiry ends this.
        const deadline = Date.parse(transaction.expires_at);
        for (;;) {
          await delay(1500, signal);
          if (Date.now() > deadline)
            throw new CalendarServiceError("authorization_expired");
          const status = await this.#authorizationStatus(path, secret, signal);
          if (status === "authorized") break;
          if (status === "failed")
            throw new CalendarServiceError("authorization_failed");
          if (status === "expired")
            throw new CalendarServiceError("authorization_expired");
        }
        const proof = { ...secret, code_verifier: verifier };
        if (base === "/v1/connections/google") {
          await this.#request(
            `${path}/redeem`,
            z.object({ connection_id: id }),
            {
              body: proof,
              signal,
            },
          );
        } else {
          // The window keeps showing the code until this attempt finishes.
          const code = await this.#confirmationCode(signal);
          const { session } = await this.#request(
            `${path}/redeem`,
            this.host.credentials ? nativeSessionSchema : sessionSchema,
            { body: { ...proof, confirmation_code: code }, signal },
          ).catch((reason: unknown) => {
            // One wrong attempt ends the transaction on the service.
            if (
              reason instanceof CalendarServiceError &&
              reason.failure !== "rate_limited" &&
              reason.failure !== "unavailable"
            )
              throw new CalendarServiceError("code_rejected");
            throw reason;
          });
          if (session.credential) {
            await this.host.credentials?.save(session.credential);
            this.#credential = session.credential;
          }
          this.storage.setItem(SIGNED_IN_KEY, "1");
          this.#publish({ sessionId: session.session_id });
        }
        await this.#discover();
      } finally {
        authorizationWindow.close();
        this.#attempt = null;
        this.#submitCode = null;
        if (this.#snapshot.awaitingCode) this.#publish({ awaitingCode: false });
      }
    });
  }

  /** A native WebView freezes behind the system browser, stalling requests until
   * they time out, so only the service's own answer can end the attempt. */
  async #authorizationStatus(
    path: string,
    secret: { polling_secret: string },
    signal: AbortSignal,
  ) {
    try {
      const { status } = await this.#request(`${path}/status`, statusSchema, {
        body: secret,
        signal,
      });
      return status;
    } catch (reason) {
      if (signal.aborted || !isTransient(reason)) throw reason;
      return "pending";
    }
  }

  #confirmationCode(signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      this.#submitCode = resolve;
      signal.addEventListener("abort", () => reject(signal.reason as Error), {
        once: true,
      });
      this.#publish({ awaitingCode: true });
    });
  }

  submitCode = (code: string) => {
    this.#publish({ awaitingCode: false });
    this.#submitCode?.(code.trim().toUpperCase());
  };

  /** Stops waiting here; the service supersedes the abandoned attempt. */
  cancelAuthorization = () => this.#attempt?.abort();

  async #discover() {
    const { connections } = await this.#request(
      "/v1/connections",
      z.object({ connections: z.array(connectionSchema).max(1) }),
    );
    const connection = connections[0] ?? null;
    this.#publish({ connection, calendars: [] });
    if (connection?.status !== "active") return;
    const { calendars } = await this.#request(
      "/v1/calendars",
      z.object({ calendars: z.array(calendarSchema) }),
    );
    const primary = calendars.filter((calendar) => calendar.is_primary);
    this.#publish({
      calendars,
      selected:
        storedSelection(this.storage) ?? primary.map((calendar) => calendar.id),
    });
  }

  refresh = () => this.#run(() => this.#discover());

  setSelected(selected: string[]) {
    this.storage.setItem(SELECTION_KEY, JSON.stringify(selected));
    this.#publish({ selected });
  }

  disconnect = () =>
    this.#run(async () => {
      const { connection } = this.#snapshot;
      if (!connection) return;
      await this.#request(`/v1/connections/${connection.id}`, null, {
        method: "DELETE",
      });
      this.storage.removeItem(SELECTION_KEY);
      this.#publish({ connection: null, calendars: [], selected: [] });
    });

  signOut = () =>
    this.#run(async () => {
      await this.#request(`/v1/devices/${this.#snapshot.sessionId}`, null, {
        method: "DELETE",
      });
      this.forget();
    });

  deleteAccount = () =>
    this.#run(async () => {
      await this.#request("/v1/account", null, { method: "DELETE" });
      this.storage.removeItem(SELECTION_KEY);
      this.forget();
    });

  /** Reads a visible range, which may be longer than one service request. */
  async events(
    calendarId: string,
    start: Date,
    end: Date,
    signal: AbortSignal,
  ): Promise<{ events: GoogleEvent[]; omitted: number }> {
    const events = new Map<string, GoogleEvent>();
    let omitted = 0;
    for (
      let from = start.getTime();
      from < end.getTime();
      from += MAX_RANGE_MS
    ) {
      const range = {
        start: new Date(from).toISOString(),
        end: new Date(
          Math.min(from + MAX_RANGE_MS, end.getTime()),
        ).toISOString(),
      };
      let cursor: string | null = null;
      for (let page = 0; ; page++) {
        if (page === MAX_PAGES_PER_RANGE)
          throw new CalendarServiceError("pagination");
        const query: URLSearchParams = new URLSearchParams({
          ...range,
          ...(cursor ? { cursor } : {}),
        });
        const result: z.infer<typeof pageSchema> = await this.#request(
          `/v1/calendars/${id.parse(calendarId)}/events?${query}`,
          pageSchema,
          { signal },
        );
        omitted += result.omitted_count;
        for (const event of result.events) {
          if (event.status === "cancelled") events.delete(event.id);
          else events.set(event.id, event);
        }
        cursor = result.next_cursor;
        if (!cursor) break;
      }
    }
    return { events: [...events.values()], omitted };
  }

  createEvent(
    calendarId: string,
    fields: EventFields & { start: EventBoundary; end: EventBoundary },
    idempotencyKey: string,
  ): Promise<GoogleEvent> {
    return this.#request(
      `/v1/calendars/${id.parse(calendarId)}/events`,
      scheduledEventSchema,
      { body: { ...fields, idempotency_key: idempotencyKey } },
    );
  }

  updateEvent(event: GoogleEvent, fields: EventFields): Promise<GoogleEvent> {
    return this.#request(eventPath(event), scheduledEventSchema, {
      method: "PATCH",
      body: fields,
      etag: event.etag,
    });
  }

  deleteEvent(event: GoogleEvent): Promise<void> {
    return this.#request(eventPath(event), null, {
      method: "DELETE",
      etag: event.etag,
    });
  }
}

const scheduledEventSchema = eventSchema.transform((event, context) => {
  if (event.status !== "cancelled") return event;
  context.addIssue({ code: "custom", message: "Event is cancelled." });
  return z.NEVER;
});

function eventPath(event: GoogleEvent): string {
  return `/v1/calendars/${id.parse(event.calendar_id)}/events/${eventId.parse(event.id)}`;
}

function isTransient(reason: unknown): boolean {
  if (reason instanceof CalendarServiceError)
    return (
      reason.failure === "unavailable" || reason.failure === "rate_limited"
    );
  return (
    reason instanceof TypeError ||
    (reason instanceof DOMException && reason.name === "TimeoutError")
  );
}

function isAbort(reason: unknown): boolean {
  return reason instanceof Error && reason.name === "AbortError";
}

export const calendarServiceClient = SERVICE_ORIGIN
  ? new CalendarServiceClient(
      SERVICE_ORIGIN,
      undefined,
      undefined,
      currentHost(),
    )
  : null;
void calendarServiceClient?.restore();

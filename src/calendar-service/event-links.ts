import type { GoogleEvent } from "./client";

const GOOGLE_CALENDAR_HOSTS = new Set([
  "www.google.com",
  "calendar.google.com",
]);

/** An https address without credentials, or nothing. */
function httpsLink(value: string | null | undefined): URL | null {
  if (!value || !URL.canParse(value)) return null;
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password
    ? url
    : null;
}

export interface EventLinks {
  /** The meeting's video call, with the host it leads to. */
  join: { href: string; host: string } | null;
  /** The event's own page in Google Calendar. */
  google: string | null;
}

/**
 * The places an event can be opened. A link arrives from whoever sent the
 * invitation, so it is checked again here and a join link names its host.
 */
export function eventLinks(event: GoogleEvent): EventLinks {
  const join = httpsLink(event.conference_link);
  const google = httpsLink(event.web_link);
  return {
    join: join && { href: join.href, host: join.host },
    google:
      google && GOOGLE_CALENDAR_HOSTS.has(google.hostname) ? google.href : null,
  };
}

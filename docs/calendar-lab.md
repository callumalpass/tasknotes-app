# Google Calendar LAB client

This experiment is disabled by default. Both `VITE_CALENDAR_LAB=1` at build time
and the exact browser origin `https://lab.tasknotes-app.pages.dev` are required.
Neither a production origin, a Pages preview URL, nor localhost enables it.
The deployment script clears this flag for staging and Candidate B.

## User flow

In Settings → Calendar → Google Calendar · LAB:

1. Sign in to Calendar LAB. This creates an independent TaskNotes Calendar
   service session; it does not reuse or change mdbase identity.
2. Connect Google Calendar in a separate consent transaction. Leave the consent
   window open until the app finishes polling and redeeming the transaction.
3. Choose up to five calendars. The primary calendar is initially selected.
4. Open a full calendar/agenda view. External events appear alongside tasks,
   labeled read-only, with dragging/resizing and task actions disabled.
5. Disconnect, sign out (revoking this device), or delete the Calendar LAB
   account. Account deletion requires confirmation and does not delete Google
   events, TaskNotes records, or the mdbase account.

The compact mini-calendar remains task-only. External events are not included
in task counts, task filtering, or the selected-day task inspector.

## Security and lifecycle

`src/calendar-service/client.ts` owns the service bearer credential, polling
secret, and client PKCE verifier in private memory. No credentials enter React
snapshots, browser storage, logs, URLs, or mdbase. Reload/navigation forgets the
local credential, including on `pagehide`; it does not revoke the server device
session. Use Sign out before leaving when possible. Memory-only storage is not
an XSS defense, and is not a proposed production session design.

OAuth opens synchronously from a user gesture and severs the opener. Only the
pinned Google authorization endpoint may receive the popup navigation. Google
codes and provider tokens terminate at the service, never this client. The
client polls and redeems using its own PKCE proof; it does not accept popup
messages or redirect query-string credentials. Closing a popup is not considered
proof of cancellation because Google's COOP policy may sever its window handle.
Use Cancel and forget local session to stop an attempt.

All requests use the fixed Calendar LAB origin, omit cookies, reject redirects,
carry a timeout, and validate responses with runtime schemas. Mutation/consent
requests are never automatically retried. Cancellation and session changes abort
requests and fence delayed responses. Invalid sessions clear local authority.
The service's existing authentication and resource-ownership checks remain the
security boundary; CORS is not authorization.

Events are fetched for the visible interval (exclusive end), at most 93 days,
250 events per page, ten pages per selected calendar, and five selected calendars.
Repeated cursors or a page-limit overflow fail visibly instead of showing a
silently truncated calendar. No event content is persisted. Range, selection,
and session changes immediately hide old results; late completions cannot
repopulate them. Service failure never blocks task access or changes task data.

## Supervised deployment (not performed by implementation tests)

Requires the companion `feature/lab-browser` service change, which allows only
the exact LAB app origin, reviewed `/v1/` methods, and Authorization/Content-Type
preflights. It does not enable Worker public or preview routes.

After coordinating the shared LAB environment and obtaining deployment approval:

1. Deploy the companion service change to the isolated Calendar LAB Worker and
   temporarily enable only its supervised public route; keep previews disabled.
2. From this app branch, run `MDBASE_ENV=lab VITE_CALENDAR_LAB=1 pnpm deploy:dev`.
   Follow the mdbase LAB skill for identity checks, browser ownership, and fixtures.
3. Use a listed Google test user and an ordinary LAB mdbase acceptance account.
   Test separate grants, event overlays, all-day/timed/recurring events, navigation,
   popup blocking/cancellation, refresh, disconnect, deletion, and service outage.
   Do not capture OAuth URLs, credentials, or private events in traces/screenshots.
4. Delete only this run's Calendar LAB authority and disposable task fixtures,
   close owned pages/browser infrastructure, and disable the Calendar public route.

Local tests use synthetic data. They are not evidence of deployed browser OAuth,
CORS enforcement by an actual browser, Google popup behavior, or visual acceptance.
Production session storage, native apps, and Obsidian integration remain separate work.

# Private feedback

TaskNotes uses the shared `@mdbase-dev/ui/feedback` provider, form, screenshot
capture and markup, and Turnstile verification. It adds no email adapter,
telemetry or storage of its own: the browser posts one bounded submission to
the managed feedback Worker (`services/feedback` in `mdbase-connect`), which
sends a private email. The Worker's origins, widgets and deployment belong to
`mdbase-cloud-ops` (`docs/feedback-worker.md`).

## Where it appears

`FeedbackRoot` (`src/app/feedback-root.tsx`) sits above the error boundary, so
a draft survives navigation, a collection change and a render failure.

- Desktop: a **Send feedback** row at the foot of the navigation rail.
- Phones: **Send feedback** under Settings → About & help. There is no entry
  in the phone shell.
- The "TaskNotes could not open" and "TaskNotes needs to restart" screens
  offer **Report a problem**.

Those two failure screens also record a bounded failure code for the optional
diagnostics attachment and nudge the icon. Routine sync, retries and background
refreshes must not; use `useFeedback().reportError` only for a failure the
person can see.

## What is sent

The application block is the product `tasknotes`, a fixed screen identifier
(`home`, `search`, `scratchpad`, `views`, `task`, `more`, `opening`,
`failure`), the build revision (version plus short commit) and the
environment. View keys, task ids, titles, paths and raw errors are never
passed. Diagnostics and a screenshot are included only when the person opts
in.

## Enablement

`feedbackConfiguration` maps the app environment to a managed endpoint and
public widget key. An environment is listed only after cloud-ops has approved
this app's origin on that Worker and widget; anything else hides every entry.

| Environment | Origin                                        | State                                             |
| ----------- | --------------------------------------------- | ------------------------------------------------- |
| Staging     | `https://staging.tasknotes.dev`               | Listed                                            |
| Production  | `https://app.tasknotes.dev` (web and Android) | Listed                                            |
| iOS         | `capacitor://app.tasknotes.dev`               | Hidden: the Worker accepts HTTPS origins only     |
| LAB, local  | any                                           | Hidden unless the build sets an explicit endpoint |

For local or LAB acceptance, set `VITE_MDBASE_FEEDBACK_URL` (HTTPS, or HTTP on
loopback) and optionally `VITE_MDBASE_FEEDBACK_TURNSTILE_SITE_KEY`. An explicit
endpoint wins over the managed one.

The published `@mdbase-dev/ui` types do not yet include the `tasknotes`
product (added in mdbase-connect #1348); `feedback-root.tsx` casts it until
the next shared UI repin.

## Keyboard

The form is a native dialog outside the TaskNotes overlay stack.
`plainShortcutsSuspended` therefore also ignores key events whose target is
inside `dialog[open]`, so capture-phase shortcuts such as task-detail `j`/`k`
and Escape do not act behind it.

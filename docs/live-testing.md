# Live interaction checklist

Use this during development of anything user-facing and after a LAB deployment.
The browser suite is the small trust core, not a substitute for exercising the app.

## Safe setup

- Pin the build/commit and record the URL, browser/device, viewport and locale.
- During development, use a loopback app with `?demo=60`. For arbitrary collection
  options, use `?demo=60&many-options` (12 statuses and priorities).
- Demo servers regenerate the app manifest with loopback URLs. Restore the
  tracked production manifest before unit/release checks or syncing their source
  to the remote builder; do not commit development-generated manifests.
- After deployment, use only the explicitly selected LAB and its disposable test
  collection. Demo mode alone does not validate LAB storage or synchronization.
- Never cross into production or staging. Do not put credentials in notes,
  screenshots, reports or commands. Keep all mutations inside the test collection.

## Daily jobs

- **Capture:** submit a plain task, then one with dates, priority, project and notes.
  Open the saved task and verify its fields; try keep-adding and dismiss/reopen a draft.
- **Triage overdue:** move overdue work to Today. Exercise both missed-deadline
  decisions, inspect Scheduled and Due separately, and Undo the change.
- **Plan the week:** change calendar layouts, select a day, schedule a task and
  confirm it remains on that civil day. Check recurrence before moving one occurrence.
- **Google Calendar:** with a disposable connected calendar, open and edit an
  event from Month, Week, Agenda and the phone Month day list; create an event,
  drag/resize a writable event, and check read-only calendars and failure states.
  Check spanning events and exclusive end dates without counting events as tasks.
  Include a timed event across several days: its Agenda row on the first, a
  middle and the last day, and its bar among the all-day entries in Week and Month.
  Decline an invitation, add a working location and recolour a calendar in Google,
  then check the struck-through row, the absent location entry and the colour.
  Leave one invitation unanswered and answer another maybe; mark a timed event
  free; add focus time and out-of-office time; check each reads apart from an
  accepted meeting in Agenda and Week. Open an event with a video call: Join
  meeting names the call's host and opens it outside the app, and Open in
  Google Calendar opens that event. Change an event in Google, switch away for
  over a minute and return: the change appears without a reload. Revoke
  TaskNotes Calendar's access in the Google account: the calendar asks to
  reconnect, and Settings shows Needs reconnecting.
  Demo task-calendar checks and mocked event tests do not prove real Google writes.
- **Open and edit:** change title, notes and a custom property; switch adjacent
  tasks, close/reopen, and confirm the saved values. In LAB, check real confirmation
  and any held/conflicted edit review instead of assuming a toast means synced.
- **Keyboard-only:** navigate rows, open commands and property pickers, filter a
  long option list, use nested Escape, and verify visible focus returns to the trigger.
  Trap Tab in modals; background shortcuts must not fire while typing.
- **Bulk reschedule:** select multiple tasks, including one leaving the current
  filter. Confirm the intended date-only change, unrelated-field preservation and
  one Undo restoring every affected record.
- **Drag:** reorder a list, move a board card, drop overdue work into another day
  section, and move a calendar task. Check dates/status, no accidental task open,
  persistence and Undo where offered.
- **Undo:** exercise completion from both row and detail, capture, deletion and
  scheduling. Check the original status and dates, not just whether a row returns.
  Check editor Undo/Redo while writing; do not assume task-level Redo exists.
- **Scratchpad:** edit/resume a note, dismiss a row menu, convert only the intended
  drafts, and delete a historical note with Undo. Check image loading/error states.
- **Phone:** use touch to navigate, capture, edit and dismiss the property sheet,
  long-press/select and swipe a row. Tap a month day: show its agenda without opening
  a task; a separate intentional task tap must still work. Check 44px targets and
  horizontal overflow on Today, task details and Scratchpad, including the keyboard.

## Evidence and follow-up

Record the exact build, scenario and starting data, actions, expected/actual result,
screenshots actually inspected, console/network errors and any saved-record checks.
Separate local demo, emulated phone, native device and LAB evidence; list untested
states. Restore changed fixture data and close only your own test sessions.

Every bug found becomes one small permanent regression test at the lowest useful
layer. Use browser tests for cross-component trust, focus or touch failures; keep
pure model/formatting cases in unit tests. Do not add another theme/layout matrix.

Run the retained browser core with `pnpm test:e2e`; its desktop project owns the
core and its mobile project owns only `e2e/phone.spec.ts`.

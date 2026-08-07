# TaskNotes

TaskNotes is a task manager for the web, iPhone, iPad, and Android. It lets you
capture and organise work while keeping your tasks as structured Markdown
records in an mdbase collection.

[Open TaskNotes](https://app.tasknotes.dev/) ·
[Try a disposable demo](https://app.tasknotes.dev/?demo=30)

## What you can do

- Capture, edit, complete, search, and reorder tasks
- Organise work with saved lists, boards, and calendars
- Set due and scheduled dates, priorities, recurrence, and reminders
- Track time and attach images
- Use Scratchpad to turn a rough outline into selected tasks
- Switch between system, light, and dark appearance
- Inspect the Markdown path behind a task whenever you want it

## What is mdbase?

[mdbase](https://mdbase.dev/) is an open specification for treating folders of
Markdown files as typed, queryable collections. Records remain ordinary
Markdown documents, while their frontmatter gives applications a shared way to
understand fields such as a task's status, priority, and due date.

TaskNotes uses [mdbase Connect](https://mdbase.dev/connect/) to request access
to a collection. You choose the collection and approve what the app may do,
whether its files are hosted online or kept on a connected computer. Access can
be changed or revoked later.

See the [mdbase overview](https://mdbase.dev/) for an introduction or the
[mdbase specification](https://mdbase.dev/spec/) for the technical details.

## Your tasks remain portable

TaskNotes works with mdbase collections. You can choose a hosted collection or
one made available by a connected computer; the same TaskNotes features and
terminology apply to both.

Your collection—not the browser or app—is the durable home of your tasks.
TaskNotes does not create a separate IndexedDB copy or open folders directly on
your device. Each task remains a Markdown record that can be used beyond the
app.

This also means TaskNotes is not an offline-first app:

- A hosted collection needs an internet connection.
- A connected-computer collection needs that computer to remain reachable.
- A change is saved once the selected collection has accepted it.

Task reminders are delivered by mdbase, so TaskNotes does not need to remain
open. Reminder notifications contain no task titles, descriptions, paths, or
record content.

## Trying the demo

The [demo](https://app.tasknotes.dev/?demo=30) opens an in-memory collection
with generated tasks. It supports the main capture, editing, views, search,
completion, time-tracking, and Scratchpad flows without connecting to or
changing a real collection.

Demo data is disposable and resets when you reload the page. Change the number
in `?demo=30` to generate a different number of tasks, up to 5,000.

## For contributors

TaskNotes is a web-first application packaged for Android and iOS with
Capacitor. It requires Node.js, pnpm, and the package snapshots committed under
`vendor/`.

```sh
pnpm install
pnpm dev
```

The development server runs at <http://127.0.0.1:4173>. For a local demo, open
<http://127.0.0.1:4173/?demo=30>.

Run the main verification suite with:

```sh
pnpm verify
pnpm test:e2e
pnpm test:production-smoke
```

To update the native projects, run `pnpm cap:sync`. Android builds require Java 21. On macOS, open the iOS project with `pnpm exec cap open ios`.

Contributor documentation:

- [Architecture and data invariants](docs/architecture.md)
- [Contract and conformance claims](docs/conformance.md)
- [Notification behaviour and setup](docs/notifications.md)
- [iOS signing and TestFlight](docs/ios-release.md)
- [Vendored package snapshots](vendor/README.md)

## Project status

TaskNotes is under active development. Its native app identifier is
`dev.tasknotes.app`; it can be installed alongside the earlier
`tasknotes-mobile` build during testing.

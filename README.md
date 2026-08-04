# TaskNotes app

TaskNotes is a web-first task client packaged for Android and iOS with
Capacitor. Every runtime opens a Markdown collection through mdbase: either a
hosted collection or a collection exposed by a connected computer.

This repository is the candidate successor to `tasknotes-mobile`. It uses the
separate application ID `dev.tasknotes.app`, so both Android builds can remain
installed while the new application is tested.

## Current scope

- One collection picker for hosted mdbase and connected-computer collections
- Ordered view navigation with saved lists, boards, calendars, and Scratchpad
- Capture, editing, completion, search, recurrence, reminders, and time tracking
- First-class image attachments with optional inline Markdown embeds
- Authority-backed, content-free reminders
- Android and iOS packaging through Capacitor
- Shared validation and mapping from `@tasknotes/model`

## Data model

mdbase is the only durable data boundary. TaskNotes does not open device folders
or maintain an IndexedDB record replica. The application calls the selected
mdbase authority through one provider-neutral `TaskRepository`; a small
in-memory cache keeps the current session coherent. Hosted use requires a
network connection, and a connected-computer collection requires that computer
to remain reachable.

Tasks remain portable Markdown records. A task's frontmatter `attachments` list
owns attachment membership, an optional image embed in the Markdown body owns
presentation, and the mdbase file descriptor owns binary metadata.

```yaml
attachments:
  - "[[Attachments/receipt.jpg]]"
```

Detaching an image removes task membership but does not delete its bytes.
Permanent deletion remains unavailable until the authority can atomically prove
that the file is unreferenced.

See [docs/architecture.md](docs/architecture.md) for the architectural
invariants and [docs/conformance.md](docs/conformance.md) for contract claims.

## Development

The repository contains versioned package snapshots under `vendor/`, so clean
checkouts and deployment workflows do not depend on sibling repositories. See
[`vendor/README.md`](vendor/README.md) before refreshing them.

```sh
pnpm install
pnpm dev
```

The application runs at <http://127.0.0.1:4173>.

### Native projects

```sh
pnpm cap:sync
```

Android requires Java 21. To install a debug build with Android Studio's JBR:

```sh
cd android
JAVA_HOME=/opt/android-studio/jbr ./gradlew :app:installDebug
```

On macOS, open the iOS project with `pnpm exec cap open ios`. See
[docs/ios-release.md](docs/ios-release.md) for signing and TestFlight setup and
[docs/notifications.md](docs/notifications.md) for native notification setup.

## Verification

```sh
pnpm verify
pnpm test:e2e
pnpm test:production-smoke
pnpm cap:sync
```

`pnpm verify` runs formatting, TypeScript, ESLint, unit and coverage gates,
TaskNotes conformance, a real mdbase collection oracle, and the production
build. Playwright uses the mdbase Connect browser fixture to exercise the same
direct repository path at desktop and phone viewports, including connected
computer authorization, create/edit/delete operations, and accessibility.

## Web deployment

The production web application is <https://app.tasknotes.dev/> on Cloudflare
Pages. Pushes to `main` run verification and browser tests, build the dedicated
web origin, and deploy `dist` with Wrangler when the repository's Cloudflare
secrets and `CLOUDFLARE_PAGES_ENABLED=1` are configured.

The legacy <https://callumalpass.github.io/tasknotes-app/> deployment remains a
rollback target. Native builds use the generated TaskNotes manifest and the
private-use OAuth callback.

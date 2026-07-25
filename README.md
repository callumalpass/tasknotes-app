# TaskNotes app

A web-first TaskNotes client packaged for Android and iOS with Capacitor. The
same React application runs in a browser, while a small storage boundary keeps
durable records in the platform's local filesystem.

This repository is the candidate successor to `tasknotes-mobile`. It uses the
separate application ID `dev.tasknotes.app`, so both Android builds can remain
installed during migration.

## Current scope

- First-run choice between device-local records and mdbase cloud
- Ordered view navigation with Today, Upcoming, saved lists, boards, and calendars
- Grouped view sources and grouped list results
- Capture, editing, completion, and client-side search
- Projects, contexts, tags, recurrence, absolute reminders, and priorities
- Authority-backed, content-free reminders for connected mdbase collections
- Offline cloud replica with background synchronization and explicit conflict resolution
- Background saves that continue while the user navigates
- Browser storage through OPFS
- Android and iOS packaging through Capacitor
- Existing-folder selection through the Android and iOS system file pickers
- A disposable IndexedDB projection for startup, sorting, and client-side search
- Shared validation and mapping from `@tasknotes/model`

The iOS project is generated and configured for Files app access; building and
signing it still requires macOS and Xcode.

## Storage model

| Runtime | Durable collection                                         | Derived index                    |
| ------- | ---------------------------------------------------------- | -------------------------------- |
| Browser | OPFS `TaskNotes/`                                          | IndexedDB                        |
| Android | `Documents/TaskNotes/` or a user-selected folder           | IndexedDB in the WebView profile |
| iOS     | App Documents `TaskNotes/` or a user-selected Files folder | IndexedDB in the WebView profile |

mdbase cloud uses a provider-hosted mdbase collection as authority and keeps a
persistent IndexedDB replica on each device. Creates and edits are applied to
that replica first, so ordinary work does not wait for a network request.

For local collections, Markdown is the source of truth and the index can be
deleted and rebuilt. Startup reconciliation compares path, modification time,
and size, then reparses only changed files. Cloud collections use a durable
offline replica because it may temporarily hold writes that have not reached
the hosted authority. Mutations are serialized at the repository boundary,
while UI saves can continue after navigation.

Android retains access to selected folders through a persisted Storage Access
Framework grant. iOS retains a security-scoped bookmark and coordinates access
with the selected Files provider. Each folder has a separate disposable index,
and the app asks the user to choose it again if access is revoked.

See [docs/architecture.md](docs/architecture.md) for the invariants and
migration plan, and [docs/conformance.md](docs/conformance.md) for the exact
contract claims.

## Development

The repository contains versioned package snapshots under `vendor/`, so clean
checkouts and deployment workflows do not depend on sibling repositories. See
[`vendor/README.md`](vendor/README.md) before refreshing them from local
development checkouts.

```sh
pnpm install
pnpm dev
```

The application runs at <http://127.0.0.1:4173>.

### Android

The generated project requires Java 21. On this machine, Android Studio's JBR
provides it:

```sh
pnpm cap:sync
cd android
JAVA_HOME=/opt/android-studio/jbr ./gradlew :app:installDebug
```

With the `medium_phone` emulator running, the native bridge smoke test creates
a task through the UI, inspects its public Markdown file, schedules a real
Android notification, kills the process, verifies persistence after relaunch,
and exercises the native mdbase OAuth callback. It temporarily moves an
existing emulator collection aside and restores it afterward:

```sh
pnpm test:android-smoke
```

Pull requests and pushes to `main` also run the complete verification suite,
Android unit tests, Android lint, and a debug APK build. The APK is retained as
a workflow artifact.

Tags named `android-v<version>` create a signed APK and Android App Bundle and
attach both to a private GitHub release. Configure these repository secrets
before creating a release tag:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

The keystore secret is the base64-encoded contents of the release `.jks` file.
Version codes use the GitHub Actions run number, while the version name comes
from the tag.

### iOS

```sh
pnpm cap:sync
pnpm exec cap open ios
```

Run the second command on macOS with Xcode installed.

Native connected reminders require a Firebase project and Apple Push
Notifications configuration. See [Notifications](docs/notifications.md).

## Verification

```sh
pnpm verify
pnpm test:e2e
pnpm test:e2e:cloud
pnpm test:android-smoke
pnpm test:production-smoke
```

`pnpm verify` includes formatting, TypeScript, ESLint, unit tests, the claimed
TaskNotes conformance profile, a real mdbase v0.3 collection oracle, and the
production build. Playwright exercises the same UI at desktop and phone
viewports.

`pnpm test:e2e:cloud` starts disposable control and hosted-provider boundaries,
then drives authorization, inline hosted-collection creation, offline work,
resumed synchronization, a two-device conflict, resolution, and cached reload.
No external account or persistent cloud data is used.

The production smoke check verifies the deployed web shell, OAuth callback,
application manifest, and the public mdbase connect health and readiness
boundaries. GitHub Actions runs it every six hours.

## Test deployment

Pushes to `main` deploy the web application to
<https://callumalpass.github.io/tasknotes-app/> through GitHub Actions. The
Pages build uses `/tasknotes-app/` as its asset and callback base and publishes
a web-only mdbase manifest. The build includes an explicit authorization
callback document and a Pages-compatible fallback so OAuth deep links load the
application. Native builds continue to use the TaskNotes-hosted manifest and
private-use callback.

## Large-vault result

On the Android 36 `medium_phone` emulator, a 10,000-record fixture produced:

- full parse and index: 7,235 ms
- unchanged warm reconciliation: 760 ms
- fixture creation through the native bridge: 46,925 ms
- fixture removal through the native bridge: 19,617 ms

The fixture writer is excluded from normal builds. To include its controls in a
local test build, run `VITE_BENCHMARK_TOOLS=1 pnpm cap:sync` before building the
APK. Always run a normal `pnpm cap:sync` afterward.

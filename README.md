# TaskNotes

TaskNotes is a task manager for the web, iPhone, iPad, and Android. It lets you
capture and organise work while keeping your tasks as structured Markdown
records in an mdbase collection.

[Open TaskNotes](https://app.tasknotes.dev/) ·
[Try a disposable demo](https://app.tasknotes.dev/?demo=30) ·
[Use the self-hosted web app without an account](#self-hosted-web-no-account)

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

The managed app uses [mdbase Connect](https://mdbase.dev/connect/) to request access
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

For collections upgraded from the Obsidian plugin's v4 release, see
[Opening a collection upgraded from TaskNotes v4](docs/migration-v4-to-v5.md)
for first-connection consent and App-version guidance.

## Trying the demo

The [demo](https://app.tasknotes.dev/?demo=30) opens an in-memory collection
with generated tasks. It supports the main capture, editing, views, search,
completion, time-tracking, and Scratchpad flows without connecting to or
changing a real collection.

Demo data is disposable and resets when you reload the page. Change the number
in `?demo=30` to generate a different number of tasks, up to 5,000.

The portable-people feature branch adds person-ID assignments and an
**Assigned to me** search filter. See [People and assignments](docs/portable-people.md)
for setup, consent, portability and coordinated-release requirements.

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

### Self-hosted web (no account)

TaskNotes has two web entries. The managed app in `dist/` keeps its existing
sign-in, PWA and Todoist importer. The self-hosted app in `out/self-hosted/` is
a static client for a collection served by `mdbase self-host`. It connects
to the server over pinned WebTransport or a trusted WSS proxy. The server
reads and writes the collection. The static host serves the app files. The
importer, notifications, calendar service, feedback and offline PWA belong
to the managed app.

1. Run `pnpm install --frozen-lockfile` and `pnpm build:self-hosted`. Serve **only
   the contents of `out/self-hosted/`** at the root of a dedicated HTTPS origin.
   Do not share an origin with the managed app, third-party scripts, or another
   service worker. Use a cookie-free site (no shared parent-domain cookies).
   Preserve the document’s CSP. Apply the distribution’s `_headers` response
   policies, including at the site root, to deny framing and disable referrers,
   MIME sniffing and caching.
2. Configure the host with the exact static UI origin. Have it print an
   invitation and a separate eight-digit pairing code. For advanced HTTPS
   proxy setup and revocation, see `runtime/docs/self-hosted.md` in mdbase-connect.
3. Open the static UI directly. To also offer it from the managed signed-out web
   screen, set `TASKNOTES_SELF_HOSTED_UI_ORIGIN=https://your-ui.example` when
   building the managed app (a repository variable for the web publisher).
   The **Advanced** link, **Connect to your own server**, appears only on the
   signed-out web screen when configured. **Return to TaskNotes** opens
   `https://app.tasknotes.dev/`. The two origins have separate sessions.
   `pnpm build` builds only the managed app.

Open the invitation, or paste the complete link into the pairing form on the
same app origin. The app removes the invitation fragment from the address bar.
Check the displayed server address against the computer showing the eight-digit
code. Choose **Pair and open collection** to grant this app read and write
access. Manual entry also accepts a pinned server descriptor or the bare HTTPS
origin of a trusted proxy. A pinned invitation requires a browser with
WebTransport. Keep codes, credentials, paths and collection names out of links.

The default pairing and task-detail drafts stay in memory for this tab.
Reloading or closing the tab drops both. **Remember this browser** saves the grant
in the app origin’s IndexedDB, encrypted with a nonextractable AES-GCM key
and bound to the exact server descriptor. With Remember, the app also saves
unconfirmed task-detail fields as plaintext in local storage for recovery after
reload. Scripts on the app origin can use the key, so trust the static host and
its scripts. A remembered browser reconnects on reload, including across
routine certificate rotations. If the grant cannot be saved, the collection
still opens and TaskNotes explains that the pairing lasts for this tab only.
An invitation with the identical descriptor reconnects automatically. A different address or
fingerprint requires an explicit choice between reconnecting to the saved
server and forgetting it to pair with the new invitation. When the certificate
schedule expires, ask for a fresh invitation and code.

TaskNotes needs a live connection to read and write this collection. Task
deletions wait in memory during the 30-second Undo window. Closing the
workspace or losing the connection cancels deletions that have yet to start.
If the connection drops during a write, check the actual record when you
reconnect before repeating the action. On the disconnection screen,
**Copy unsaved edits** copies an open task’s draft. Reopening that task offers
its retained changes for review in the same tab. A remembered browser can also
recover them after reload. Task and view routes use fragments.

**Reconnect** uses the current grant. When the app says the server was not
reached, the code was never sent and is still good. If pairing was interrupted
after that, check the server’s paired browsers before requesting another code.
If the server refuses the current grant, request a new code. Use **Settings → Collection →
Change collection** to close the workspace. **Forget this browser** asks for
confirmation and removes the local pairing and what TaskNotes kept for that
exact server descriptor: task drafts, recent searches and tasks, and
per-collection view state. To revoke access, remove the browser on the server.
When TaskNotes receives the refusal it clears the same state. A tab-only pairing
uses **Disconnect**, and closing or reloading its tab clears that state too.
Browser history, the language choice and layout preferences that name no
collection can remain on a shared device. Links to web addresses in task notes
open in a new tab without a referrer; links to other notes are shown as text.
The direct build never falls back to managed sign-in or registers a worker.
It refuses to pair if any service worker controls the page or remains registered
on the origin. It never unregisters workers or clears managed caches. An
existing managed installation can therefore keep its PWA and cached assets.

To verify the production entry locally with Playwright Chromium and a matching
`mdbase` CLI, without a real account, collection or deployment:

```sh
pnpm install --frozen-lockfile
pnpm build:self-hosted
node scripts/direct-web-proof.mjs /absolute/path/to/mdbase out/self-hosted
```

`node scripts/preview-self-hosted.mjs` serves the built UI over disposable
loopback TLS for a manual check. The automated proof creates its own synthetic
Markdown, operator state and browser profiles, then removes them on exit.
It stops the daemon while one task draft and a second browser’s deletion Undo
window are open, checks the clipboard and Markdown, reconnects, and verifies
that the cancelled deletion did not run.

### Todoist importer workspace

Todoist import is a lazy feature at `https://app.tasknotes.dev/import`, also
available from Settings → Collection. It uses the app's existing mdbase session
and selected collection, with explicit preview and destination confirmation.
The tested engine lives in [`apps/import`](apps/import/README.md); its old shell
is retained as a regression harness. Both share the root lockfile, model catalog and canonical
contract provision. `pnpm check:workspace` rejects SDK/model drift: the importer
uses the exact npm SDK publication matching the main app's authenticated
vendored original, including its integrity. The main app retains its original
archive-based publisher and separate staging/LAB inputs.

```sh
pnpm import:dev
rpnpm import:check
pnpm import:test:e2e # local browser checks, after building apps/import/dist
```

`pnpm verify` checks the main app including its integrated import UI.
`pnpm verify:workspace` also checks the engine and regression shell. CI checks
both packages on every PR. Engine changes affect the main bundle and do not skip
native builds. The integrated route ships through the existing app publisher;
there is no separate importer publisher. This source change does not deploy the
route or redirect/retire the old standalone site.

### Main app deployment

Publish the current working tree to the isolated TaskNotes LAB surface with:

```sh
pnpm dlx wrangler@4.114.0 login # first use only
pnpm deploy:dev
```

LAB is the fail-closed default. The command builds a web-only manifest for
<https://lab.tasknotes-app.pages.dev>, connects it only to
<https://connect-lab.mdbase.dev> and the isolated connector on
`127.0.0.1:28487`, deploys only the Cloudflare `lab` branch, then verifies the
built artifacts and live application. Unknown targets and URL overrides from a
different environment are rejected. It does not change staging or the
production `app.tasknotes.dev` deployment.

Deploying the separate staging surface remains explicit:

```sh
MDBASE_ENV=staging pnpm deploy:dev
```

That command targets <https://staging.tasknotes.dev>, staging Connect,
and the Cloudflare `staging` branch.

To update the native projects, run `pnpm cap:sync`. Android builds require Java 21. On macOS, open the iOS project with `pnpm exec cap open ios`.

Contributor documentation:

- [Web deployment and production gate](docs/deployment.md)
- [Architecture and data invariants](docs/architecture.md)
- [Contract and conformance claims](docs/conformance.md)
- [Notification behaviour and setup](docs/notifications.md)
- [Android signing and Google Play closed testing](docs/android-release.md)
- [iOS signing and TestFlight](docs/ios-release.md)
- [Vendored package snapshots](vendor/README.md)

## Project status

TaskNotes is under active development. Its native app identifier is
`dev.tasknotes.app`; it can be installed alongside the earlier
`tasknotes-mobile` build during testing.

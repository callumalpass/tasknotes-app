# Next-only replace-at-cutover app (development, not a release)

`next/next-only-app` starts from `main` and targets a next-only `main`. The old `feat/dual-backend` branch is scaffolding only.

## Callum's cutover decision

After a canary, migration uses one window for everyone. The next-only build replaces the old app at **https://app.tasknotes.dev**. No router, second TaskNotes address, redirect or shipped dual-backend repository. Editor, Writer, Reader and Journals follow the same pattern.

Callum20:26 cancelled the final legacy build and legacy-data startup inspection/gate. The old app is unchanged; arch's scanner stays parked/unmerged. The new app starts normally without inspecting old local data. The announcement asks users to let their apps sync before the window; no recovery of unpersisted old drafts is promised. Next journals/custody remain disjoint: no adoption of old credentials or automatic replay of old queued intents.

The old deployment pin is historical evidence only, not an active capture/build/deployment request.

## Explicit LAB/production selection

`VITE_TASKNOTES_ENVIRONMENT` explicitly selects `lab` or `production`. Production has no second-origin input: its fixed approved page is `app.tasknotes.dev`; a LAB origin in a production build refuses. There is no production `VITE_TASKNOTES_NEXT_ORIGIN` concept.

LAB requires an explicit canonical `VITE_TASKNOTES_LAB_ORIGIN=http://127.0.0.1:<port>` that exactly matches the page's origin. `.env.lab.example` retains the historical harness default; a separate release-owned helper uses its own vacant port without changing that harness. No runtime-origin inference or app-side allowlist operation is performed. Release supplies independently authenticated LAB trust/module/tool pins and a compatible native artifact. Old #630 WASM does not implement GET and must not be used for startup. Production never bundles LAB inputs and still requires release's authenticated production trust/artifact.

For a separately approved LAB build, set `TASKNOTES_APP_URL` and `VITE_TASKNOTES_LAB_ORIGIN` to the same exact loopback origin, plus `VITE_TASKNOTES_ENVIRONMENT=lab`. The existing manifest generator emits the canonical declaration for that origin; the runtime does not rewrite it. Building or registering that declaration does not authorize serving it. Existing helpers and their ports remain separate.

`requireTaskNotesAppEnvironment` is configuration validation, not authority or startup evidence. Native Worker/controller and ordinary startup wiring are being completed; no old-storage gate is required.

## Registered application metadata

The authenticated LAB build supplies the registered application ID
`5cdfa020-c201-4da8-845a-f2cc9969eade` and exact name `TaskNotes` through the
Worker to the protected SDK sign-in controller. The origin remains the exact configured
LAB origin above; neither metadata value is a grant, credential, or UI choice.
This source branch pins the SDK archive to
`3491a619ed8ecb5d27b71af8f725771b1eafa5cb`, using the original
`sdk-dev-3491a619.tgz` and provenance in
`vendor/sdk-dev-3491a619.json`. This concrete original coordinator-approved
DEV/LAB intake is not release-qualified. It includes shared error descriptions,
status summaries, opaque push helpers, mobile origin/sign-in APIs, setup planning
and collection availability/lifecycle APIs. App adoption and delivery
qualification remain separate. It retains shared factory #819, canonical
no-email provider receipts #827, bounded failure classification #832, signal
composition #837 and the original shared-facade Bases READ FIFO. It also retains SDK563's
original-target enrollment reconciliation. Enrollment
503/network loss stays an unknown outcome; a visible Retry invokes only the
SDK's explicit original-target selection/reconciliation. The SDK retains the
original device, keys and operation, requires current approval and clean stop,
and uses fresh proof against the prior enrollment tuple. Only positively
classified pre-enrollment challenge exhaustion has bounded retry. Permanent
refusals and failed-stop recovery do not receive this action.
The original protocol beta.129/c280cd19 archive is a normal file dependency in
`vendor/`; the historical 3c14fc91 archive remains intact. The earlier protocol
override stays removed so it cannot replace the SDK's original dependency. The SDK's bundled protocol matches that same original
archive. The active successor has no vendor warnings or unused protocol archive.
The retained historical first DEV cut, `4b955381`, contains an unused
`vendor/mdbase-dev-connect-protocol-0.1.0-beta.129.tgz`, SHA256
`dfc5db0daf6700874aa2c6235b86570f1d4e444740d0925bf1f97551cf43d3bd`.
The named co0648 exception applies only to this immutable cut, not its successor;
that archive is not an active dependency. Legacy Connect packages retain their
ordinary protocol dependencies.
This archive includes the live browser singleton and SDK-owned requested versus
usable collection selection. Node/SSR without a browser Worker host remain
honestly unavailable. Every production route now uses the single SDK application
entry, its selection snapshot and its borrowed original records client. Popup,
URL/history, setup, physical close and reapproval stay SDK-owned; cancelling the
app's presentation-only picker leaves the usable workspace and route intact.
This cut includes the SDK-owned fixes for complete-manifest validation and
literal Vite Worker/WASM asset emission. Do not normalize the app's registered
manifest or work around SDK Worker/asset packaging in the app. Manifest generation
is unchanged: LAB builds retain the LAB-mode canonical bytes; the production
manifest has a different origin and digest. This source
intake does not qualify native compatibility. The producer's `native.available: true` means original
native assets are packaged: runtime 3a1266b5 (3580229 bytes, SHA256
`51f4a0c4e20fedd8d8e2f2bb66f540aff7e4050c2901b53fe556c0a0098d5a6d`)
and the original SQLite bytes. The packaged `rt_app_setup_assess` export is
verified; export presence is not setup execution or native custody evidence. It is not a public runtime readiness signal;
Node's `MdbaseConnect` fallback reports `application_not_yet_available`, while
browser initialization has its own registration, manifest and asset checks. The shared entry uses the SDK's original packaged assets; it does not take an
app runtime/trust callback. Historical D70 app-host files remain untouched for
reference and local fixtures, but are no longer the production entry. The immutable concrete archive,
not `sdk-dev-latest`, is the consumer authority. A source pin does not identify
the currently served build or authorize a runtime refresh, session enablement
or deployment.

Existing protected app IDs, origins, environments, accounts, devices, namespaces,
and key derivations are not rewritten. Refused original restoration stays refused;
only an explicit user sign-in may start a new flow. There is no alias migration,
automatic fresh-mode retry, or device replacement. The declaration supplies no replacement runtime or trust pins. The SDK package
retains its own original integrity-pinned inputs. This source adaptation is not
combined-runtime or live sign-in acceptance.

Canonical no-email SDK snapshots carry null `accountEmail`,
`accountProvider:"github"` and a nonblank login of at most 100 UTF-8 bytes,
without whitespace or control characters. Partial, mixed and unknown-provider
presentation fields are refused. The renderer labels the paired account with
its authenticated GitHub login; login never substitutes for the original account
UUID, email, installation identifier, namespace or custody input. Earlier SDK
provenance remains historical evidence.

Optional SDK failure details accept exactly the bounded public `{name,code}`
shape, with codes correlated to their allowlisted class category. Absence remains
valid; a successful snapshot cannot retain failure details. No message, stack,
cause, response, URL or identity fields are accepted. `open_failed` has fixed
preserve-storage copy rather than implying recovery or retry safety. These
presentation details never authorize new operations, native cleanup or readiness.

## Completed setup and current readiness

Verified setup is immutable history, not a requirement to keep its original
mutable definition or saved-view bytes. Readiness uses complete confirmed
resource inventory, compatible `tasknotes.task` providers and `obsidian.base`
implementations from the native catalog, plus current native source identity and
body reads. Current source records may be pending or confirmed only with exact
identity, revision and complete native body readback, and without a hold or
unresolved state. Original unfinished setup still requires its exact confirmed
readback. User-defined implementing types count; factory paths and the five
initial default views do not. Editing or deleting defaults never recreates them.

Missing required models still require explicit setup. New additive v4 rounds
retain their verified predecessor unchanged and capture `sourcePolicy:
"current-only"`, without default-source creation. An absent marker retains every
original initial/default readback guard, including old unfinished v4 rounds with
no source creates. Prepared, attempted and confirmed plans still reconcile their
original UUID, exact receipt, resource bytes and source identities; no conversion,
reset or new-plan fallback is introduced. Core deliberately preserves deleted
installed seeds: a metadata-only factory offer cannot repair that deletion, so an
implementing model must be restored or supplied explicitly instead.

## Scratchpad creation and recovery limits

A native creation policy may assign a different portable Scratchpad ID from the
one requested by the app. For a fresh initial note or its replacement, the app
reads the original native UUID, checks confirmation and any supplied receipt
path/revision, and decodes the actual active, empty note. It does not replace the
native UUID or mutation ID. Existing-note saves, reactivation and duplicate-note
reconciliation retain their strict portable-identity witnesses.

`getActiveScratchpad()` is not a read-only recovery action: it creates a note
when none is active and may submit a CAS batch to reconcile several active notes.
`listScratchpads()` also invokes that action. `getScratchpad(portableId)` only
reads the complete stream; it does not create a note or settle an earlier
mutation.

For task, Scratchpad note/image metadata and view-source writes, `NextMutations`
can return a genuine native pending result separately from authority confirmation.
Original result readers and exact request keys remain in repository-instance
memory for same-instance uncertain-result recovery, never replacement submission.
After local delivery, an older ACK reads current native bytes/metadata, including
subsequent edits or deletions, rather than installing its receipt document.
The manager can restore record/MID/status metadata from the native pending queue
and reconcile those original receipts with genuine current record READs. It does
not reconstruct the original app result reader or input after reload. A native
pending queue and a restarted app result are different evidence. Preserve the original device, collection and operation
identity after an unknown outcome; do not treat a new note, reset or replacement
ID as recovery. Native restart and physical-durability acceptance remain separate
checks.

A repository normally owns its SDK client's lifetime. An explicit
`clientOwnership: "borrowed"` composition releases only that repository's scope,
watchers and listeners on disposal; the host retains the original client's close.
This allows metadata rehydration over the same native client without closing the
live caller or creating a replacement session. It does not extend a retired host's
lifetime or qualify process restart/custody.

## Collection files

`NextTaskRepository.files` borrows the selected original SDK records client's
files port. Actions reflect its current grant; the SDK enforces the folder scope
and every operation. The adapter's original lifetime, caller signal and request
budget remain attached to transfers and mutations. Disposal does not close a
borrowed SDK client or establish physical native drain.

Upload, replacement, move and delete await the original write's confirmation,
not local pending delivery or publication. Replacement retains the original
native file ID and current digest expectation. Move and delete pass the original
mutation ID when supplied and use digest CAS. Errors and unknown outcomes do not
trigger another application submission. Returned metadata comes from the SDK;
media type is Core-derived rather than substituted with the upload hint.

Saved file revisions are **current-digest expectations, not historical lookup
keys**. The SDK stream is opened with the explicit expected revision, and its
returned ID, digest, size and path are checked before exposing bytes. Byte counts
are checked through EOF. The buffered convenience read is capped at 64 MiB;
streaming is available separately. An already-open stream can retain earlier
content, but fresh reopening after replacement or reload cannot retrieve an old
revision. This source adapter and its synthetic SDK transport tests do not
qualify native/LAB binary persistence or restart recovery.

## Source intake and remaining work

Native repository/domain/recovery/watch tests are carried from scaffolding while preserving main's protected-edit UI. The dual account factory, mixed Connect development archives and legacy timer factory were not carried. Immutable standalone view compiler bytes are a hash-checked test oracle, not a runtime fallback.

The native entry point uses `AppWebSignInSession` on SDK9ab for the original
protected request, approval polling, device, native host and ownership leases.
The production welcome renderer consumes its public snapshot directly, without
a legacy snapshot adapter. The existing single-port collection/journal boundary
and `NextTaskRepository` remain until separate shared-factory/two-port adoption. Paired shared-session authorization requests
same-installation additive consent, with named creation owned by the Connect
portal and creation permission explicitly requested. The app must not retain a
second old owner or invent a shared-session `createCollection()` method.

Sign-in reserves the production named 620×760 Connect popup synchronously in
the click. Its SDK-validated first-party opener relationship is retained so the
app can close it after confirmed approval, unlike the SDK9ab doc's detached
opener recommendation. No secrets, postMessage completion or storage callbacks
use that relationship. The fallback tab is immediately opener-detached; its
cross-origin close remains best-effort. A paired account still approving additive
consent does not close the popup prematurely.

Provider labels, recent-visit metadata, legacy setup/access reviews and manual
sign-in recovery/cancellation are not fabricated from SDK discovery. The existing
model setup gate remains; automatic original-setup recovery is a separate change.

Startup diagnostics use `tasknotes:startup:<local-counter>:<stage>` marks and
measures and one `[TaskNotes startup timing ms]` debug line after the first
non-stale view execution reaches its React layout commit. Labels and duration
values contain no account, collection, request, source or error details.
`native_open` spans SDK public `opening` through the original app adapter's
completion, including leases, ledger reads, bootstrap, SQL and verified log READ;
`bootstrap`, `sql_open` and `verified_read` are nested, not additive. SDK device
open before `opening` is outside this span. UI `repository_init`, first
`setup_assessment`, `first_query` and `first_render` are separate intervals;
`first_render` is result-to-React-commit, not browser paint. Cached/stale results
never complete query/render diagnostics. Timing failures do not change an
operation's success, rejection, abort or readiness. These are measurement
boundaries, not evidence that any phase is fast or that native startup is qualified.

Saved follows original confirmations; native local capture is not authority
confirmation. Routine pending feedback stays out of rows and editor flow,
waits two seconds, then uses a quiet Syncing… overlay without live announcements.
Sustained disconnection and prolonged waits escalate politely; rejection,
conflict and unknown outcomes remain visible with a review action, never
replacement submissions. Save state comes from the SDK's write ledger, which
restores unconfirmed writes after a reload and settles them from receipts. Task-editor edits that have not yet reached the SDK (autosave debounce, or reads before capture) are copied synchronously to localStorage per collection and task, kept until the SDK confirms the save (an offline write can still be refused, and the ledger does not keep its content), and offered back for explicit review on the next open; a refused edit reopens in the editor, and Keep my edit re-applies only the changed fields on the latest version. Definitions, model settings and setup remain confirmed-only.
Real ordinary startup, current-account/revoke and restart/offline must be
qualified. A build-graph gate excludes all classic repositories/transports/runtime.
Unsupported reminders and authenticated record authors remain explicit; they
are not emulated through legacy. Native Files persistence remains separately
qualified from the normal SDK files adapter and optional file timestamps.

Publication versions/manifests/trust and production cutover/promotion remain separately owned. No production deployment or mobile submission is authorized by this source branch.

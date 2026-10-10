# Next-only replace-at-cutover app (development, not a release)

`next/next-only-app` starts from `main` and targets a next-only `main`. The old `feat/dual-backend` branch is scaffolding only.

## Callum's cutover decision

After a canary, migration uses one window for everyone. The next-only build replaces the old app at **https://app.tasknotes.dev**. No router, second TaskNotes address, redirect or shipped dual-backend repository. Editor, Writer, Reader and Journals follow the same pattern.

Callum20:26 cancelled the final legacy build and legacy-data startup inspection/gate. The old app is unchanged; arch's scanner stays parked/unmerged. The new app starts normally without inspecting old local data. The announcement asks users to let their apps sync before the window; no recovery of unpersisted old drafts is promised. Next journals/custody remain disjoint: no adoption of old credentials or automatic replay of old queued intents.

The old deployment pin is historical evidence only, not an active capture/build/deployment request.

## Explicit LAB/production selection

`VITE_TASKNOTES_ENVIRONMENT` explicitly selects `lab` or `production`. Production has no second-origin input: its fixed approved page is `app.tasknotes.dev`; a LAB origin in a production build refuses. There is no production `VITE_TASKNOTES_NEXT_ORIGIN` concept.

LAB uses `.env.lab.example` and the fixed isolated `VITE_TASKNOTES_LAB_ORIGIN=http://127.0.0.1:48218`, with strict host/port and the separately approved LAB-only Connect C5 allowlist. Release supplies independently authenticated LAB trust/module/tool pins and a compatible native artifact. Old #630 WASM does not implement GET and must not be used for startup. Production never bundles LAB inputs and still requires release's authenticated production trust/artifact.

`requireTaskNotesAppEnvironment` is configuration validation, not authority or startup evidence. Native Worker/controller and ordinary startup wiring are being completed; no old-storage gate is required.

## Registered application metadata

The authenticated LAB build supplies the registered application ID
`5cdfa020-c201-4da8-845a-f2cc9969eade` and exact name `TaskNotes` through the
Worker to the protected SDK sign-in controller. The origin remains the fixed
LAB origin above; neither metadata value is a grant, credential, or UI choice.
This source branch pins the SDK archive to
`9ab0f31d43ae801241acb5fbc11f3be4ceefa76b`, with provenance in
`vendor/mdbase-dev-sdk-9ab0f31d.json`. A source pin does not identify the currently
served build or authorize a runtime refresh, session enablement or deployment.

Existing protected app IDs, origins, environments, accounts, devices, namespaces,
and key derivations are not rewritten. Refused original restoration stays refused;
only an explicit user sign-in may start a new flow. There is no alias migration,
automatic fresh-mode retry, or device replacement. This caller/source intake does
not change the native runtime or trust pins and is not combined-runtime or
live sign-in acceptance.

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

The current `NextMutations` manager retains its pending mutation ID, known receipt
and original confirmed-result reader in repository-instance memory. A retry in
that same instance observes the original receipt/result rather than resubmitting.
Reloading does not establish that this app reader was reconstructed, even if
native storage survives. Preserve the original device, collection and operation
identity after an unknown outcome; do not treat a new note, reset or replacement
ID as recovery. Native restart and physical-durability acceptance remain separate
checks.

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

Saved follows original confirmations, never dirty drafts or pending retries.
Real ordinary startup, current-account/revoke and restart/offline must be
qualified. A build-graph gate excludes all classic repositories/transports/runtime.
Unsupported reminders, file metadata and authenticated record authors remain
explicit; they are not emulated through legacy. An optional file timestamp does
not make native Files available.

Publication versions/manifests/trust and production cutover/promotion remain separately owned. No production deployment or mobile submission is authorized by this source branch.

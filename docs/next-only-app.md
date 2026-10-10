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
The SDK archive is pinned to source `5369226d26baa338b98e25feed9c0454e52f5865`
with provenance in `vendor/mdbase-dev-sdk-5369226d.json`.

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
body reads. User-defined implementing types count; factory paths and the five
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

## Source intake and remaining work

Native repository/domain/recovery/watch tests are carried from scaffolding while preserving main's protected-edit UI. The dual account factory, mixed Connect development archives and legacy timer factory were not carried. Immutable standalone view compiler bytes are a hash-checked test oracle, not a runtime fallback.

The current collection entry point/dependency graph still needs replacement by protected installation sign-in, C5 initial/additive consent, the owned native host and `NextTaskRepository`. Saved follows original confirmations, never dirty drafts or pending retries. Real ordinary startup, current-account/revoke and restart/offline must be qualified. A build-graph gate excludes all classic repositories/transports/runtime. Unsupported timers/size/mtime/authenticated-record-authors are explicit, not emulated through legacy.

Publication versions/manifests/trust and production cutover/promotion remain separately owned. No production deployment or mobile submission is authorized by this source branch.

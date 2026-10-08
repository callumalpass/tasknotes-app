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

## Source intake and remaining work

Native repository/domain/recovery/watch tests are carried from scaffolding while preserving main's protected-edit UI. The dual account factory, mixed Connect development archives and legacy timer factory were not carried. Immutable standalone view compiler bytes are a hash-checked test oracle, not a runtime fallback.

The current collection entry point/dependency graph still needs replacement by protected installation sign-in, C5 initial/additive consent, the owned native host and `NextTaskRepository`. Saved follows original confirmations, never dirty drafts or pending retries. Real ordinary startup, current-account/revoke and restart/offline must be qualified. A build-graph gate excludes all classic repositories/transports/runtime. Unsupported timers/size/mtime/authenticated-record-authors are explicit, not emulated through legacy.

Publication versions/manifests/trust and production cutover/promotion remain separately owned. No production deployment or mobile submission is authorized by this source branch.

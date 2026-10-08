# Next-only replace-at-cutover app (development, not a release)

`next/next-only-app` starts from `main` and targets a next-only `main`. The old `feat/dual-backend` branch is scaffolding only.

## Callum's cutover decision

After a canary, migration uses one window for everyone. The next-only build replaces the old app at **https://app.tasknotes.dev**. No router, second TaskNotes address, redirect or shipped dual-backend repository. Editor, Writer, Reader and Journals follow the same pattern.

Before native startup the new app must inspect the actual old build's same-origin storage and surface unsynced/uncertain old edits as held items to review or explicitly export. Originals remain untouched; no automatic replay, deletion, conversion into next receipts, or adoption of old credentials/keys. Unknown or unreadable state is held, not interpreted as empty. Next journals use disjoint namespaces.

The reference old deployment is pinned by release at source `d1869ab9577f0f3dd124efb7a56c714e32fdd385`, deployment `2debb450-dc01-4439-bcd0-00140a940be8`. Inventory its actual storage formats/dependency bytes, not today's main. Source pin is not permission to deploy or mutate old data.

## Explicit LAB/production selection

`VITE_TASKNOTES_ENVIRONMENT` explicitly selects `lab` or `production`. Production has no second-origin input: its fixed approved page is `app.tasknotes.dev`; a LAB origin in a production build refuses. There is no production `VITE_TASKNOTES_NEXT_ORIGIN` concept.

LAB uses `.env.lab.example` and the fixed isolated `VITE_TASKNOTES_LAB_ORIGIN=http://127.0.0.1:48218`, with strict host/port and the separately approved LAB-only Connect C5 allowlist. Release supplies independently authenticated LAB trust/module/tool pins and a compatible native artifact. Old #630 WASM does not implement GET and must not be used for startup. Production never bundles LAB inputs and still requires release's authenticated production trust/artifact.

`requireTaskNotesAppEnvironment` is configuration validation, not authority or startup evidence. The old-storage hold gate and native startup wiring remain to be completed.

## Source intake and remaining work

Native repository/domain/recovery/watch tests are carried from scaffolding while preserving main's protected-edit UI. The dual account factory, mixed Connect development archives and legacy timer factory were not carried. Immutable standalone view compiler bytes are a hash-checked test oracle, not a runtime fallback.

The current collection entry point/dependency graph still needs replacement by protected installation sign-in, C5 initial/additive consent, the owned native host and `NextTaskRepository`. Saved follows original confirmations, never dirty drafts or pending retries. Real ordinary startup, current-account/revoke, restart/offline and same-origin legacy hold/export must be qualified. A build-graph gate excludes all classic repositories/transports/runtime. Unsupported timers/size/mtime/authenticated-record-authors are explicit, not emulated through legacy.

Publication versions/manifests/trust and production cutover/promotion remain separately owned. No production deployment or mobile submission is authorized by this source branch.

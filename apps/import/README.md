# TaskNotes Import

## Integrated app route

The production entry point is the main app's lazy `/import` route (Settings →
Collection → Import from Todoist). It borrows the existing selected connection
through this package's create-only repository adapter, with no additional mdbase
login or grant. The main app owns setup, localization, navigation, theme, static
routes and Todoist metadata. Todoist remains read-only; preview, explicit
priority/date mappings, destination confirmation, no-overwrite semantics,
original-mutation recovery and reports remain intact. Only active tasks are
supported, with the deliberate conversion limits below.

This package exports only engine/authorization/adapter modules to the app, never
the old shell's `connect.ts` singleton. The old shell/build/browser suite below
is retained for regression testing, not production publication. Its deployment
workflow has been removed. The standalone configuration below is for its
regression harness only and must not be used for a new publisher.
No remote redirect, OAuth cutover or deployment is performed by this change.

This is the importer's maintained source inside `tasknotes-app`. It was brought
over from `callumalpass/tasknotes-import` at `11ee104` with the November 15, 2026
SDK/contract refresh. The integrated route uses the main app's authentication
origin and existing publisher; native/store qualification remains separate.

## What works

- Todoist public-client OAuth using metadata discovery + PKCE, requesting only `data:read`.
- Validated, cursor-paginated active tasks, projects, sections, and account identity.
- Task selection and explicit priority/date mapping.
- App-owned, provider-neutral mdbase Connect collection authorization and importer discovery.
- **Approved collection setup** using the main app's canonical TaskNotes provision. Empty collections can be made compatible; seed definitions are not blindly replaced. The app's SDK-owned setup requires explicit approval; the importer never applies a changed setup plan automatically.
- Shared `@tasknotes/model` mapping plus destination JSON Schema validation without `eval`.
- Markdown preview, warnings and blocked conversions, create-only import, duplicate checks, cancellation between writes, durable SDK mutation recovery, and downloadable reports.
- A network-free conversion example in the legacy regression shell.

### Deliberate limits

Active tasks only. No completed history, comment/attachment copying, reminders, assignees, or native subtask/project hierarchy reconstruction. Project names and source hierarchy metadata are preserved, not recreated as project notes. Supported recurrence is currently English, all-day `every day`/`daily` and `every week`/`weekly`. Other recurrence and floating datetimes are blocked. Date-only and explicit-offset timestamps are supported; fixed-zone timed recurrence is blocked.

Custom types must use flat contract field mappings and frontmatter-authoritative titles. Additional required fields and unavailable schema references block the preview rather than invent values. Creation timestamps/IDs may be governed by destination lifecycle rules; original Todoist metadata is preserved in the body. Files use `todoist-<account-and-task SHA-256>.md` under the reviewed import folder. This is one-way migration, **not synchronization**.

## Development

Requires Node 22.12+ and the root pnpm version. Run these commands from the
repository root; do not create another lockfile inside this directory.

```sh
pnpm install --frozen-lockfile
pnpm import:dev
rpnpm import:check
pnpm --filter tasknotes-import exec playwright install chromium
cd apps/import
rpnpm --pull dist build
cd ../..
pnpm import:test:e2e
```

`pnpm import:dev` generates metadata for the configured HTTPS origin. Local example mode works without any accounts; account actions refuse a different browser origin. Live browser OAuth requires publicly accessible HTTPS metadata; neither Todoist metadata discovery nor the production SDK accepts an ordinary localhost homepage.

`pnpm import:check` runs the workspace drift guard, metadata validation,
typecheck, unit tests and importer production build. Root CI runs it plus the
importer's browser suite on every PR, including shared SDK/contract changes.
The main app also typechecks and bundles the engine and tests the integrated
route. Engine changes affect web/native builds; the old shell is not bundled.

The root `pnpm-workspace.yaml` catalogs pin SDK `0.1.0-beta.218` and model
`0.3.0`. The importer's npm SDK must match the root production-original pin's
version and SRI; tests also verify its installed trust and native asset bytes.
The main app retains its authenticated archive and protected staging publisher.
Both metadata builders load the one root canonical catalog provision through
`scripts/canonical-task-pack.mjs`; no importer vendor copy is maintained.

Build configuration is passed as shell environment variables (not secrets):

```sh
VITE_APP_URL=https://tasknotes-import.pages.dev \
VITE_MDBASE_CONNECT_URL=https://connect.mdbase.dev pnpm import:build
```

The vendored original contains **production-only trust**. Connect defaults to `https://connect.mdbase.dev`; another `VITE_MDBASE_CONNECT_URL` or any `VITE_MDBASE_LOOPBACK_URL` fails the build rather than retargeting production trust. The SDK owns transport selection, native Worker, storage, and WASM assets. Isolated LAB acceptance requires a separately qualified LAB SDK original, not a URL override. Never point automated acceptance at production.

The build generates both authorization documents and pins their exact origin. Deployment-hash URLs can preview the page, but account authorization requires the configured stable origin. Callback `.html` files are intentionally served by Pages at extensionless paths: **do not replace them with directory index files**, which introduce trailing-slash redirects.

## Cloudflare Pages

The integrated route uses the root app's existing Pages build and publisher.
Its `/import` and `/import/todoist/callback` routes and public Todoist metadata
are generated with the app. No new project, publisher, custom domain, Pages
Functions, D1, KV or application backend is required.

### GitHub Actions

- Root `ci.yml`, job `importer-verify`: typecheck, unit tests, manifest validation, production build, and desktop/mobile browser tests on every PR and main push.
- Root app verification and the existing publisher remain the release gates.
- No independent importer deployment workflow is maintained.
- Pull requests do not publish the old shell or receive importer credentials.

### Retiring the old standalone site

The old `tasknotes-import.pages.dev` deployment is not redirected, disabled or
changed by this implementation. Before any separately approved cutover, settle
pending original mutations in that build and retire its publisher/Git
integration. Do not copy authorization state or replay recovery handles across
origins. Then validate fresh consent and imports at `app.tasknotes.dev/import`.

No Todoist client secret is needed for the currently documented public-client flow. Its real consent/token exchange still needs human acceptance with an actual Todoist account before public launch. The automated OAuth test uses synthetic responses, not a real account.

## Safety and privacy

- Todoist access tokens are not persisted. Only one short-lived, one-use PKCE transaction goes into sessionStorage.
- Source tasks remain in browser memory until cleared/reloaded. There is no analytics or importer database.
- Connect owns its credential/key storage, collection selection, authorization, and encrypted transport. Setup is applied only through its reviewed assessment/approval mechanisms.
- The importer needs **full-collection read access** to detect previous imports. The integrated route reuses the main app's reviewed grant without expanding it. Its narrow repository performs only discovery, reads, creates and original-mutation recovery. The regression shell's separate declaration requests `collection.read`, `records.create` and `definitions.manage` for reviewed setup.
- Source identity is account-scoped and stored as a final Markdown body marker. Duplicate detection scans records, including moved imported records. Removing that marker loses move-aware recognition; an occupied deterministic path still blocks replacement.
- Every native query page is checked for unrelated path collisions before writes. No existing record is overwritten. Unknown or still-pending writes stop the run. Recovery uses the SDK ledger's original mutation IDs and receipt lookup, never a replacement create. “Created” requires log confirmation and verified native record readback.
- Cancel waits for an in-flight write to resolve. Import is not atomic; the report distinguishes created, skipped, failed, uncertain, and not-started records. There is no automatic rollback or deletion.
- Imported Markdown is shown as escaped text, never rendered as executable HTML.
- Cloudflare receives normal static-hosting requests. The destination provider receives imported records. No claim is made that Connect grants disappear when the tab closes; revoke grants in Connect/Todoist when finished.

## Dependencies

As verified on 2026-11-15, the importer uses the published production SDK `0.1.0-beta.218`, stable `@tasknotes/model@0.3.0`, and canonical TaskNotes pack `0.3.0-rc.21`. The pack provides `tasknotes.task@0.3.0-rc.6`, `tasknotes.settings@1.1.0`, and `mdbase.app-settings@2.0.0`. The complete canonical task/settings provision is reviewed through SDK setup; the importer does not author replacement seed definitions or settings records.

The root `vendor/` contains the byte-identical SDK original used by current TaskNotes app main, independently compared against its npm publication, plus the producer's SDK pin and canonical catalog provision. The protocol is bundled, not separately pinned. Metadata generation checks the catalog digest and model compatibility; integrity tests bind the original archive, lockfile, production trust and native inputs. See `vendor/README.md`; do not substitute mutable npm `latest` or rebuild the original.

This replaces the beta.94 integration entirely. Existing imported records retain their source markers and deterministic paths. Old beta.94 browser authorizations and pending-write recovery handles are **not** native SDK mutation identities: reauthorize collections, and settle any old pending writes using the original importer build before upgrading. No legacy storage or mutation requests are adopted or replayed.

## Verification so far

- Unit tests: OAuth state/replay/expiry/PKCE; pagination and HTTP failures; schema/field/date/recurrence conversion; native SDK MemoryReplica imports, confirmation/readback, duplicate detection across pages, late path collisions, in-flight cancellation, partial resumption, pending/unknown receipts and original mutation recovery across a reopened SDK client; original archive/provenance and emitted-native-input integrity.
- Desktop/mobile Chromium tests: example preview under no-eval CSP, synthetic Todoist OAuth success/denial/replay, token-exchange and API failures, duplicate source-page refusal, redirect-free metadata/routes, no horizontal overflow, native asset SHA-256 verification, and WASM compilation under the Pages CSP (`wasm-unsafe-eval`, not JavaScript `unsafe-eval`).
- Historical beta.94 isolated LAB acceptance: explicit setup of a disposable blank hosted collection, import of two synthetic source tasks, and duplicate skipping on repeat. Test collection deleted afterward; browser lease stopped. This is **not** live acceptance of the native SDK migration. No production collection was used.

See `docs/implementation-notes.md` for remaining work and acceptance details.

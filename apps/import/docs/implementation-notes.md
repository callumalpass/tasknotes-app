# Initial implementation

## Architecture

- `src/oauth.ts`: one-use, ten-minute PKCE transaction; in-memory Todoist token.
- `src/todoist.ts`: validated read-only API v1 adapter with pagination.
- `src/plan.ts`: pure destination-aware conversion, schema validation, warnings/blockers, account-scoped provenance, Markdown preview.
- `src/task-repository.ts`: the narrow create-only application port.
- `src/storage/task-repository.ts`: provider-neutral SDK adapter, preflight duplicate/collision scan, sequential creates, original-mutation recovery, stop-on-failure, progress reports and between-write cancellation.
- `src/connect.ts`: provider-neutral application session and repository construction.
- `src/destination.ts`: pure exact-contract discovery and schema checks.
- `src/App.tsx`: three-stage import UI and explicit setup review.
- `scripts/metadata.mjs`: canonical Todoist and Connect declarations for one configured origin, with TaskNotes-only setup provisions.
- `scripts/routes.mjs`: Pages-compatible extensionless callback assets without slash redirects.

Current inputs, verified on 2026-11-15: SDK `0.1.0-beta.218`, stable `@tasknotes/model@0.3.0`, task contract `tasknotes.task@0.3.0-rc.6`, and canonical catalog pack `0.3.0-rc.21`. The complete pack includes companion `tasknotes.settings@1.1.0` and `mdbase.app-settings@2.0.0` definitions and reviewed upgrade baselines. The importer does not create its own settings record, view or scratchpad. Metadata generation verifies the original catalog digest and model contract identity.

## Acceptance evidence

Local unit and desktop/mobile browser tests cover preview, schema validation under CSP without JavaScript `unsafe-eval`, synthetic OAuth completion, idempotent import behavior, and failure boundaries. The LAB evidence below belongs to the original beta.94 implementation, not the native SDK migration.

Isolated LAB acceptance completed against the deployed LAB control plane and a new disposable hosted collection:

1. Authorize the importer on its HTTPS LAB preview origin.
2. Select the blank fixture and explicitly approve “Set up and allow access”.
3. Observe ready state and discovery of the canonical `task` type.
4. Load two synthetic Todoist tasks through intercepted source OAuth/API responses.
5. Preview and explicitly approve import: two created.
6. Repeat: zero created, two skipped.
7. Delete only the run-owned fixture and stop the run-owned browser lease.

LAB evidence is private and deliberately not committed. This verifies the real destination setup/import path, **not** real Todoist consent or token exchange. Local-folder destination integration still needs acceptance.

The exercise found and fixed two real browser integration issues:

- Cloudflare Pages directory-index callbacks redirected to a trailing slash. The assets now use `callback.html`, served at `/callback`; deployment smoke tests reject redirects.
- Assigning native `fetch` directly as an instance method caused an illegal invocation in Chromium. The adapter now invokes it through a closure; browser callback tests cover this.

## Native SDK migration

The legacy beta.94 Connect/protocol/dev originals are removed. The only Connect entry is now `createMdbase` from the published production SDK beta.218. Its npm bytes match the unchanged root `sdk-17b79aec-production-beta218.tgz` original. See the root `vendor/README.md` for source, SHA-256/SRI and producer-pin boundaries. The superseded beta.141 build archive and its build-specific proof inventory are removed, not relabelled.

- The bundled declaration uses capability contract v2 (`collection.read`, `records.create`, `definitions.manage`) and the configured HTTPS production installation origin. The SDK constructor validates it during metadata generation, replacing the old dev CLI. No direct protocol, UI, or i18n dependency is needed.
- UI readiness comes only from `snapshot.phase`; the ready phase supplies the original connection/records client. Private consent callbacks use `deliverAppGrantCallback` without starting another session.
- Discovery calls native `describe({ definitions: true })`, matches the current model's exact TaskNotes contract version/digest, and consumes the SDK's plain JSON definitions, schemas and field maps directly. It does not decode these answers a second time as wire maps. Missing schemas or unsupported semantics still block.
- Setup uses a reviewable SDK plan, then applies that original plan on explicit approval. A changed plan is not automatically reapplied; unknown setup remains SDK-owned recovery.
- Duplicate/collision preflight reads every native page with `include: { body: true }`; confirmed readback uses the same current SDK include options. Incomplete/stale scans and pending/conflicted records refuse writes. Native create remains create-only, including races after preflight.
- Captured writes retain the SDK mutation ID in reports and its durable ledger. Import waits for log confirmation using the SDK's receipt options object and verifies the native record/body marker before reporting created. Pending, rejected, unknown, and failed readback stop the run. Recovery reads `snapshot.sync.writes` and looks up the same mutation; it never reconstructs or resubmits a create. Cancellation remains between writes.
- Vite emits the original SDK Worker, runtime WASM, SQLite WASM, and initializer. Pages CSP permits WASM compilation only (`wasm-unsafe-eval`), not JavaScript eval. Both callbacks remain static extensionless assets without redirects.

Existing imported task records keep their source markers and deterministic paths, so repeat imports still skip them. New plans use the current shared model and exact canonical task contract; older definitions require the reviewed canonical setup upgrade rather than a fallback or fabricated field map. Beta.94 browser credentials/recovery handles cannot be converted into native SDK identities. Users must settle old pending writes in the old build before upgrading and authorize the new native session; there is no compatibility shim or old-journal replay.

The original contains production-only trust. LAB/local URL overrides now fail closed; a future live isolated LAB exercise needs the matching qualified LAB original. This migration was tested locally with the SDK MemoryReplica and synthetic browser flows, not against real accounts or a deployed native destination. No deployment or workflow dispatch was part of that refresh. Its historical standalone deployment gate is superseded by the repository move below.

### 2026-11-15 dependency refresh verification

- `npm run check`: metadata/catalog/model compatibility, TypeScript, 46 unit tests in seven files, production Vite build and static callback generation passed.
- `npm run test:e2e -- --workers=1`: 14 Chromium tests passed across desktop and emulated iPhone 13, including the current contract metadata, example conversion, synthetic Todoist OAuth, static callbacks and original WASM assets under Pages CSP. Emulation is not physical-device acceptance.
- Formatting and `git diff --check` passed. The SDK original was byte-identical to its pinned npm publication; the catalog provision matched the published SHA-256 and current TaskNotes app main.
- Current SDK MemoryReplica does not provide the complete contract schemas required by `describe({ definitions: true })`. Discovery tests separately exercise its real plain JSON decoding and fail-closed summary handling, plus complete synthetic definition/schema fixtures; they do not stand in for a native authority setup test.
- Real Todoist consent and hosted/computer-backed destination setup/import remain untested for this refresh. Historical LAB evidence is not reused as a pass, and production was not accessed.

## 2026-11-15 repository move

This records the initial packaging step. Its separate-application and publisher
decisions are superseded by the integrated route below; its test results remain
historical evidence for that earlier source state.

The maintained importer is now `apps/import` in `tasknotes-app`, brought over
from standalone commit `11ee104` plus the uncommitted dependency refresh described
above. The old checkout has not been deleted, archived or modified by this move.

- The root app remains in place. The importer is not a web/native route or bundle entry.
- One pnpm workspace/lockfile and catalog coordinate the SDK/model inputs. The root app keeps its authenticated SDK archive; importer npm integrity must match it. Root staging/LAB SDK selection stays separate and is not a way to retarget this production-only importer.
- Both apps use the root canonical catalog provision and shared digest/model validation. Importer-owned copies and the npm lockfile are removed.
- Importer discovery, create-only scanning/writes and original-mutation recovery are behind its narrow `TaskRepository` port and SDK storage adapter. It deliberately does not implement the main editor's broader task/scratchpad/files repository. UI code owns no durable collection reads or writes.
- Authentication and explicit setup-plan approval remain SDK-owned. Source identities, deterministic paths, duplicate protection, confirmed readback, cancellation boundaries and report copy are unchanged.
- Importer checks run independently on every PR. Importer-only PRs do not trigger Android/iOS builds; shared package/catalog/lock changes still do. Main pushes retain exact-SHA native checks required by the store publishers. The main app's tests and lint exclude this separate application.
- The new Pages workflow uses `tasknotes-import-production`, namespaced credentials, and the disabled-by-default `TASKNOTES_IMPORT_PAGES_ENABLED` gate. No credential migration, environment creation, OAuth/DNS change, release approval or deployment is performed here.

### Repository-move verification

- `rpnpm verify`: passed the main app's complete verification gate, including release/publisher regression tests, formatting, typecheck, lint, coverage, conformance and production build. The main coverage suite passed all 2,065 tests across 253 files.
- `rpnpm --pull apps/import/dist import:check`: passed the shared input/integrity guard, metadata validation, typecheck, all 51 importer unit tests and production build.
- `pnpm import:test:e2e --workers=1`: all 14 desktop/emulated-mobile Chromium tests passed against the final importer build, including synthetic OAuth, static callbacks and native SDK assets under Pages CSP.
- The shared canonical loader is checked from both application working directories and through the main app's Vitest environment. Protected staging SDK lock rewrites leave the importer dependency unchanged.

These results are local workspace evidence, not live-account or deployment
acceptance. Real Todoist consent, live hosted/computer-backed setup/import and
physical-device qualification remain unrun. No production accounts were accessed
and no publication or remote cutover was performed.

### Reliability follow-up

- Added 12 unit regressions for cancellation before and during a captured write, resuming partial imports, post-scan path races, interrupted readback, original-mutation recovery after reopening the SDK client, source HTTP errors, cross-page duplicate IDs, malformed later pages and request cancellation.
- `rpnpm --pull apps/import/dist import:check`: all 63 unit tests passed, along with typecheck, shared SDK/contract integrity checks, authorization metadata validation and the production build.
- `rpnpm --filter tasknotes-import test src/importer.test.ts --sequence.shuffle --sequence.seed=15112026`: all 25 import/recovery tests passed again in shuffled order.
- Added five browser failure scenarios: denied/replayed consent, failed token exchange, source HTTP 429/503 and duplicate IDs on a later source page. The expanded suite has 24 desktop/emulated-mobile tests; `pnpm import:test:e2e --workers=1 --repeat-each=2` passed all 48 executions without retries.
- SDK write tests use the actual pinned SDK with its `MemoryReplica`. The reopen test retains the same in-memory ledger store across two SDK clients; it does not qualify browser disk persistence, real transport interruptions or a live provider. Browser OAuth/API responses are synthetic and external network access is blocked in the new failure tests.

No application behavior was changed by this follow-up. The supported synthetic
paths showed no functional failures, but real Todoist consent and isolated live
hosted/computer-backed destination acceptance remain required before public
launch. Large-account performance and physical-device acceptance remain unrun.

## 2026-11-15 integrated app route

The importer is now a lazy feature of the root app at `/import`, linked from
Settings → Collection. It borrows the selected connection through its narrow
create-only repository instead of constructing another mdbase client or grant.
The main app owns reviewed setup, theme, navigation and Lingui localization.
Native shells link to web import without attempting unqualified native OAuth.

- Read-only Todoist metadata is generated at `/oauth/todoist-client.json` for the configured app origin. `/import/todoist/callback` is a static, redirect-free callback that clears OAuth parameters before startup, exchanges the one-use PKCE transaction once and retains only source data in memory. The app's mdbase identity/callback is unchanged.
- Preview requires explicit task/date/priority choices and destination review. Destination definitions are checked again before writing. Cancellation/unmount stops future creates, never abandons an already captured mutation, and a changed collection generation prevents the next create.
- Uncertain reports prohibit replay and recover only their original mutation IDs. Existing pending/rejected shared-ledger entries block a new import; after reload the app's shared pending-write review owns reconciliation.
- The engine remains in `apps/import`; its original shell and browser suite are regression-only. Root CI retains engine qualification, engine changes no longer skip native builds, and the independent importer deployment workflow is removed. The existing root app publisher and native/store approvals are unchanged.
- Added seven integrated UI tests, three callback tests, main metadata/history/static-route regressions, and an engine regression for a collection change between confirmed writes. Thirty-one new source messages have authored translations in all nine target locales and compiler-generated catalogues. Translations are agent-authored, not native-speaker certified.

### Integrated-route verification

Verified on November 15, 2026 in the uncommitted integration worktree on base
`35dd96551a7d256edb46eb06dce8d28464a36604`:

- `rpnpm --pull dist verify:workspace` passed: strict catalogue checks, release/publisher regressions, formatting, typecheck, lint, 2,077 app tests across 255 files, application/domain coverage gates, conformance, production app build, shared SDK/catalog integrity, 64 importer tests across seven files and regression-shell build. Existing lint/chunk-size warnings remain nonfatal. One release test and one conformance test report their existing skips.
- `rpnpm i18n:source` passed. Extraction reports 1,542 messages and no missing authored targets in any locale; local compiler generation completed successfully.
- `pnpm test:e2e e2e/import.spec.ts --project desktop --workers=1 --repeat-each=2 --retries=0` passed all six executions. This covers direct routing, the Collection settings entry, no fabricated demo destination, disabled preview without a destination and 390px layout. Desktop/phone screenshots were captured and inspected.
- `pnpm import:test:e2e --workers=1` passed all 24 retained desktop/emulated-mobile browser tests, including synthetic OAuth failure/replay, conversion, theme, static routes and original SDK/WASM assets. The shell is a regression harness, not the integrated collection UI.
- The final app build contains `/import` and exact `/import/todoist/callback` assets/200 rewrites, and metadata for `https://app.tasknotes.dev` requesting only `data:read`. `git diff --check` passed. No dev server was left running.

These are local/synthetic checks, not real Todoist consent, real provider imports,
browser-disk recovery or native-device qualification. No production accounts,
deployment, remote cutover, commit or push were involved.

## Before public launch

- Complete real Todoist public-client metadata/PKCE consent and code exchange with a test account. Validate current task/user response shapes and priority numbering against that account. Review Todoist public-client limits and terms.
- Qualify and publish through the root app's existing immutable publisher. No new importer environment or Cloudflare token is required. Separately approve and verify any retirement/redirect of the old standalone site after settling its original pending writes.
- Accept a computer-backed LAB destination, permission denial, stale setup assessment, connector interruption, and pending-write recovery through the actual UI.
- Add user-friendly priority labels only after verifying current API vs UI numbering. Current explicit API-value mapping avoids automatic inversions.
- Improve unsupported-rule selection, recurrence conversion coverage, large-account responsiveness, and bundle splitting.
- Exercise destination custom-type coverage more broadly (nested mappings, filename-title types, custom schema references, identifying-property edge cases).
- Add optional history, comments/attachment copying, project/subtask note reconstruction only with explicit loss reporting and tests.

## Operational notes

The intended production entry point is `app.tasknotes.dev/import`; automated
tests never authenticate there. The old standalone deployment is not redirected,
disabled or changed remotely by this implementation. Its prior LAB deployment
notes are historical and do not authorize retargeting a production-only SDK.
There is no cross-origin credential or pending-mutation migration. No commit,
push, deployment, remote publisher change or account access is performed by this
integration.

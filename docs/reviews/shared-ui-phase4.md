# Shared UI Phase 4 handoff

Base: merged Phase 3 (`2066b238`, PR #194). Branch: `refactor/shared-ui-phase4`.

## Correctness first

Five new retention/session regressions were confirmed failing before changes:
source revisions accumulated, identities and estimated bytes were unbounded,
late reads restored obsolete revisions, and the session rebuilt the adapter's
cumulative prefix. The shared repository contract then reproduced unbounded
demo retention too.

Both adapters now retain at most 16 view identities and an 8 MiB **estimated**
UTF-16 JSON budget, one source revision per identity. This is not a precise heap
measurement. Oversized results are returned intact but omitted from the cache.
The real adapter's ownership slot prevents an old completion from restoring an
invalidated/evicted/replaced execution. Catalog removal prunes identities.

An explicit `cumulative` iterator option lets ViewQuerySession consume the
adapter's snapshot directly. Default raw pages, 200-row paging, partial-prefix
retention, cursor closure, cancellation and exact saved-view write recovery
remain covered. The shared contract checks immutable cumulative row prefixes,
complete record counts and retention/revision behavior against both adapters.
Document-cache limits remain 64 entries / 8 MiB; the weighted eviction owner is
shared with view retention rather than copied.

## Shared pieces adopted

Pinned `@mdbase-dev/ui@0.1.0-beta.117`, using export subpaths only:

- Theme preference loading/normalization/storage/application, with a tiny local
  wrapper retaining TaskNotes' `#fbfcfe` light browser-chrome color.
- CodeMirror theme resolution/observation; custom editor/popup appearance stays.
- Browse `moveMenuFocus`; events stay inside the menu and the existing overlay
  stack, placement and resize dismissal stay owned locally.

Stock ThemeSelect would replace the mobile-aware local select. SaveNotice's span,
icon/fade and styling do not replace the task detail's retry button. Stock popup
styles and global overlay hooks likewise are not equivalent; none was swapped
in to manufacture savings. No CSS, branding, Scratchpad screen or Scratchpad
lifecycle was changed. Locks/coordinator/journal/recovery were not rewritten.

## Production accounting

Physical TS/TSX lines (including blanks) against `origin/main`; tests excluded.
New files count positively, so moving ownership is not credited as deletion.

| File                                        |    Before |     After |     Net |
| ------------------------------------------- | --------: | --------: | ------: |
| `src/theme.ts`                              |        41 |        26 |     −15 |
| `src/components/markdown-source-editor.tsx` |       266 |       251 |     −15 |
| `src/app/app-shell.tsx`                     |       969 |       944 |     −25 |
| `src/application/ports/task-repository.ts`  |       209 |       210 |      +1 |
| `src/application/view-query-session.ts`     |       185 |       186 |      +1 |
| `src/demo/demo-task-repository.ts`          |     1,219 |     1,227 |      +8 |
| `src/storage/bounded-cache.ts` (new)        |         0 |        45 |     +45 |
| `src/storage/mdbase-repository.ts`          |     2,626 |     2,597 |     −29 |
| `src/storage/mdbase-view-adapter.ts`        |       293 |       328 |     +35 |
| `src/storage/task-document-cache.ts`        |        45 |        19 |     −26 |
| **Total changed production source**         | **5,853** | **5,833** | **−20** |

Shared UI adoption itself is −55; correctness/cache ownership is +64; removing
saved-view facade forwarding boilerplate is −29. Tests are net +199. Dependency
metadata and this report are separate, not production savings. No extraction
is counted by considering only its shrinking source file.

## Checks and evidence

- Final `pnpm verify`: green; 947 main-suite tests, 109 coverage-suite tests,
  189 contract-suite tests; lint/typecheck/build included.
- Targeted desktop/mobile theme/Browse/view-editing Playwright: 6 passed.
- Final full Playwright: 125 passed, 5 existing skips, using isolated port 4190.
- Existing browser fixtures still log reminder reconciliation/clear warnings
  (`undefined.map`) and ResizeObserver loop messages. The suite passes; those
  warnings were not hidden or fixed in this scope.
- E2E-generated manifest restored; no timeout relaxation, sleeps or deployments.
- Logs: `/tmp/tn4-retention-red.log`, `/tmp/tn4-demo-retention-red.log`,
  `/tmp/tn4-final-verify.log`, `/tmp/tn4-final-playwright.log`.

Proposal only, outside this app repository:
`/home/calluma/projects/sdk-review/tasknotes-review/shared-connection-ui.md`.
It contains current per-app file:line evidence, API/ownership boundaries,
consumer deletion estimates and migration gates. No shared gate/picker/setup
implementation or sibling-app changes were made. No PR was opened.

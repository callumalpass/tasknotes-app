# Daily experience refinement

Implemented on `improve/daily-experience` in
`~/worktrees/tasknotes-app/daily-experience`. The canonical checkout stays on
`main`. No LAB services, live collections, or deployment workflows were used.

## Scope

- Collapsible grouped sections, expanded by default, with local preferences
  scoped to collection, saved view, and section. Reordering temporarily opens
  sections and reveals empty destinations without overwriting preferences.
- View options replace competing header icons. Reorder tasks is an explicit
  mode; Done hides list handles without discarding the saved sort or ranks.
- Visible Scheduled / Due labels, both dates where applicable, quieter routine
  defaults, stronger task titles, softer rules, and clearer completion circles.
- A contextual mobile capture button replaces duplicate list capture. It uses
  the same composer and view creation defaults as desktop capture.
- Editable/removable date tokens and an interpreted-title preview. Manual field
  edits survive further typing. Complete drafts survive failed writes and only
  clear after acceptance. Keep adding tasks supports consecutive capture.
- Capture follows the visual viewport above an overlay keyboard.
- Note-first task details with a title completion control, compact schedule and
  status disclosure, quieter attachment copy, and progressive advanced fields.
- Today / Upcoming / Scratchpad defaults for new collections. Existing and
  migrated navigation choices are preserved. Mobile Browse includes additional
  destinations, Manage views, and Settings.
- Task-detail focus and scroll restoration, including a focusable fallback when
  a task leaves the list. Navigating to a different workspace does not restore
  the previous workspace's scroll position.
- Today / Tomorrow / In one week date shortcuts preserve an existing time.
  Existing haptics, deletion undo, reduced-motion support, and storage trust
  boundaries are retained.

## Deliberate boundaries

There is no overdue-review mode, bulk rescheduling workflow, or automatic hiding
of overdue work. Today section membership/order and saved-view query semantics
are unchanged. Scratchpad keeps its established name and note-to-task lifecycle.
Existing navigation preferences are not forcibly migrated to the new defaults.
No gamification or delayed write acknowledgement was introduced.

## Incremental commits

1. `e318623` — remembered collapsible sections.
2. `7bf5dcb` — quiet view controls and explicit date metadata.
3. `ba70afa` — retained capture drafts and contextual mobile entry.
4. `30970a6` — note-first detail, navigation, and visual hierarchy.
5. `823a285` — completion, quick dates, keyboard-safe capture, and polish.
6. `f9b71a5` — local browser regression coverage.

## Local validation

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`: 543 tests in 97 files.
- `pnpm build`: production build and manifest validation.
- Browser suite: 33 passed, one duplicate viewport-matrix run intentionally
  skipped on the mobile project (the desktop project explicitly runs all sizes).

```sh
TASKNOTES_DEV_PORT=4297 \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4297 \
pnpm exec playwright test \
  e2e/daily-experience.spec.ts e2e/accessibility.spec.ts e2e/demo.spec.ts
```

Browser coverage uses the disposable in-memory demo and local onboarding, not
an authority connection. It includes capture, natural-language dates, removal
and consecutive creation, remembered collapsing, reordering, note details,
focus return, navigation, existing Scratchpad flows, attachments, view editing,
and axe checks. Explicit viewport widths are 320, 390, 768, 1024, and 1440px.
An overlay keyboard is simulated through VisualViewport. Actual native keyboard
behavior and haptics still need device acceptance testing.

Screenshots are generated beneath `test-results/daily-experience-*` for light
and dark Today, collapsed Today, capture, task detail, and the viewport matrix.
Screenshots are local artifacts, not committed binaries. Visual inspection
caught mapped date fields still receiving the compact class; the final browser
test now checks both date labels stay uncollapsed.

The worktree has its own dependencies. An initial run with a dependency symlink
passed functionally but could not serve font files under Vite's filesystem
allowlist; the visual suite was rerun with local dependencies and working fonts.
A later browser run encountered Chromium `ERR_NETWORK_CHANGED` while fetching
local modules on the initial demo page. The full 33-test suite passed on rerun;
no timeout increase or retry policy was added to hide the interruption.

# Whole-app polish follow-up — September 10, 2026 (AEST)

Implementation of the 16 findings in the September 9 UTC whole-app audit.
Base: merged PR #156 (`eec7d1b`). Branch: `improve/whole-app-polish`.
This is UI/interaction refinement, not a new authority or synchronization layer.

## Findings addressed

| Finding | Response                                                                                                                                                                                                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01     | Navigation responds to observed keyboard/viewport occlusion, not editable focus alone.                                                                                                                                                                                             |
| P02     | A shared collection-availability notice survives successful cached reads, with retry and connection settings. Mocked outage/recovery tests cover desktop and phone.                                                                                                                |
| P03     | Priority values use readable ink plus decorative color swatches; menu hints retain contrast. Stored custom colors are unchanged. Scratchpad history no longer fades readable metadata during arrival.                                                                              |
| P04     | Intrinsic sizing, wrapping, navigation labels, calendar controls, settings, project headers, and view-editor actions reflow at 320px with 200% root text. Intentional calendar/board scrolling stays local.                                                                        |
| P05     | Calendar More has 44px targets in both layouts and themes.                                                                                                                                                                                                                         |
| P06     | Task titles occupy the available content width with at least 44px height, without overlapping completion, dates, or actions. Measured windowing replaces row-level intrinsic-height guesses.                                                                                       |
| P07     | Phone Scratchpad reserves writing width; conversion/individual creation live in row menus, with dragging and depth controls in the focused toolbar. Leading row controls are 44px.                                                                                                 |
| P08     | Phone calendars use one contextual capture button. Day taps browse; timed selection still starts capture. Project capture also opens the phone sheet with its project defaults. Saved layouts are not replaced.                                                                    |
| P09     | Browse dismisses on Tab and scopes arrow handling to the menu. Calendar overflow owns focus, has an opaque readable surface, fits above navigation, suspends only its covered grid, and retires before another overlay takes over. Escape and subsequent focus return are covered. |
| P10     | Projects gain remembered collection/view-scoped collapse choices, counts, and a compact jump selector that expands and focuses the chosen group. Collapsed task components unmount.                                                                                                |
| P11     | Search names observed non-title matches in notes, projects, contexts, tags, or attachments. It does not change query semantics or fetch a second copy of tasks.                                                                                                                    |
| P12     | Closing an accepted capture announces Task added with Open and dismiss actions. The current view stays put. Confirmation is repository/route-scoped, has no action timeout, and yields to deletion recovery.                                                                       |
| P13     | View editing has one compact Preview disclosure. Phone layout choices initially summarize the selection, bringing filters forward. Planner is explicitly an external app before saving.                                                                                            |
| P14     | Organize summaries and field labels share a link-display formatter instead of exposing wikilink/Markdown syntax. Stored references remain unchanged.                                                                                                                               |
| P15     | Archive and Upcoming have contextual empty copy. Stale empty views do not imply completion. Startup failures lead with humane recovery language and retain technical details in a disclosure.                                                                                      |
| P16     | Settings gets its version from `package.json` through the build definition, not a hardcoded label.                                                                                                                                                                                 |

The underlying model, Scheduled/Due vocabulary, saved-view customization, and
navigation preferences remain intact. There is no overdue-review workflow,
automatic overdue hiding, special bulk rescheduling, device-folder access, or
IndexedDB task replica.

## Verification

Final application code: `fae7f93` (following `172435c`, `278f0b8`, `dd33c70`,
`276b1b7`, `610ebf6`, and `5bc35eb`).

- `pnpm verify` passed: formatting, typecheck, lint, **607 unit tests / 110 files**,
  overall/application/domain coverage gates, conformance, and production build.
- **4,982 TaskNotes conformance checks** passed, one skipped; the isolated local
  mdbase v0.3 collection oracle passed.
- Production-mode E2E build and all six local browser suites passed:
  **93 tests**, including **10 fully mocked relay checks**; one intentional
  duplicate-matrix case skipped. Desktop Chrome and Pixel 7 emulation were used.
- **76 axe scans** passed with zero configured-rule violations or page errors:
  52 primary surfaces plus 24 expanded/interaction states, at 390px and 1280px,
  light and dark. These are automated checks, not accessibility certification.
- Reflow checks cover nine working surfaces, expanded settings, view-editor
  action geometry, and existing note/reminder checks at 320px/200% text.
- Existing large-list DOM, paging, scrolling, and detail-focus browser budgets
  pass. The earlier median performance benchmark was not repeated.

The browser suite initially exposed a transient localhost
`net::ERR_NETWORK_CHANGED` load failure; its trace is retained. A separate
immediate Scratchpad scan caught metadata partway through the old history fade;
that animation was removed and the check passed six repeated executions.
Visual review also caught transparent calendar overflow and awkward confirmation
button wrapping; both were corrected and rescanned. Final full runs pass without
retries or suppressed accessibility rules.

Testing used local synthetic/demo fixtures and fully mocked relay traffic only.
No LAB, live collection, real task data, deployment, or canonical-checkout testing
was used. Generated manifests were restored after building.

## Evidence and remaining acceptance

Original audit:
`~/.local/state/tasknotes-ui-audit/2026-09-09-whole-app-polish/report.md`

Follow-up evidence:
`~/.local/state/tasknotes-ui-audit/2026-09-10-whole-app-polish-fixes/`

- `final-surfaces/`: 52 observations and viewport/full-page images.
- `final-details/`: 24 observations and images, including view editing, Planner
  labeling, calendar overflow, capture confirmation, collapsed projects, and
  note-match search.
- `logs/` and `repro/`: verification output and local probe scripts.
- `transient-localhost-network-change.zip`: the diagnosed infrastructure failure.

Physical keyboards/IME occlusion, VoiceOver/TalkBack, native Dynamic Type,
notification delivery, real authority outages, heavy media, and external Planner
behavior still require device/authority acceptance. This work neither deploys
nor claims that acceptance. Broader collection hydration and non-list windowing
remain the limits described in [interaction architecture](../interaction-architecture.md).

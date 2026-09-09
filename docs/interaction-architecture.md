# Interaction lifecycle and bounded lists

Follow-up to the [September 9 audit](audits/2026-09-09-ui-ux-performance.md),
implemented incrementally on `improve/daily-experience` / PR #156. This is an
incremental application-layer refactor, not a new data authority or task replica.

## Ownership rules

- **Capture sessions own drafts; sheets only present them.**
  `application/capture-session.ts` retains text and manual fields in a
  repository-scoped, named session. Dismissal does not discard a draft. Explicit
  discard, parsing generations, submission exclusion, acceptance, and follow-up
  notices have separate lifecycles. A refresh failure is not a failed create.
  Old callbacks cannot close or change the context of newer input. Retention is
  in-memory for the repository session, not recovery across application restarts.
- **Commands own pending/error state.** `application/task-mutations.ts` joins
  repeated explicit intent, queues different intent, and publishes key-scoped
  state without rerendering the entire collection. A queued opposite intent
  prevents a subsequent command from incorrectly joining an older command.
  Completion adapters return their promises. Rows, menus, and details observe
  the same controller; failures have visible retry paths.
- **Completion expresses the desired state.** `setTaskCompletion` carries the
  target task/occurrence and `completed`. The provider-neutral repository's
  completion operation refreshes authority state before checking it within its
  serialized, revision-guarded write scope.
  Retried or concurrent completion must not reopen the task. Ordinary, virtual
  recurring, and materialized occurrence semantics remain in the domain/adapter.
- **The overlay stack owns dismissal and modal isolation.**
  `components/overlays/` coordinates topmost Escape/outside-pointer handling,
  inert background branches, scroll locking, Tab containment, and focus return.
  Capture, shared field popovers, property editors, task menus, and view editing
  use it. Child handlers consume Escape before their parent can dismiss.
- **Queries own asynchronous read lifetime.** `QueryResource` distinguishes
  loading, refreshing, success, failure, and retained stale data, and rejects
  superseded callbacks. Search no longer translates failure into an empty result.
  A sentinel record distinguishes a full prefix from an exact total; additional
  results can be requested explicitly.
- **A saved-view session owns its read cursor.** `ViewQuerySession` requests the
  first 200-record page without draining the iterator. Load more advances that
  cursor rather than rereading every earlier page. Query order, total count, and
  group metadata come from the authority. Failed or prematurely terminated
  cursors leave visibly stale partial results and require a fresh query. Closing
  the session or suspending the repository releases even a paused cursor.
- **Rendering is bounded independently of reads.** `BoundedList` uses one measured
  window across the whole task list, including section headings. Lists/search
  over 100 rows use it. The focused row remains mounted while its menu/detail
  owns focus. Hidden mobile workspaces must not overwrite measured heights with
  zero. Collapsing a section removes its task components, not just their paint.

All durable operations still go through `TaskRepository`. These controllers keep
only transient interaction/read state. There is no IndexedDB task replica,
provider-specific UI routing, device-folder access, or new synchronization engine.

## Partial results and manual ordering

A partial view says how many matching tasks are loaded, and makes clear that
section counts cover that subset. Pagination is not an overdue filter: Scheduled
and Due retain their meanings, section membership rules are unchanged, and no
special overdue review/rescheduling workflow is introduced.

Rank calculations must not use a partial prefix. Entering reordering explicitly
loads the complete view before enabling handles; rejected sort activation never
enters the mode. Capture into an incompletely loaded manual-order view obtains a
complete, non-stale scope before choosing an append rank. Failed preconditions
leave the draft intact. Already requested prefixes are retained across query
refreshes. Reordering deliberately uses the complete, non-windowed interaction
path so existing drag, keyboard, and cross-section semantics are preserved.

## Audit follow-up

| Findings | Implemented response                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A01–A03  | Nested dismissal ownership, retained drafts, explicit discard, acceptance/version guards                                              |
| A04      | Desired completion, shared pending/error state, duplicate/queued-intent guards and retry                                              |
| A05, A08 | Explicit failed/stale search state and honest prefix counts/load-more                                                                 |
| A06      | Mobile property editor isolation, focus containment, and focus return                                                                 |
| A07      | Paged task-list reads, windowed task-list/search DOM, unmounted collapsed rows; broader collection work remains below                 |
| A09      | Valid Scratchpad textbox autocomplete relationships without unsupported `aria-expanded`                                               |
| A10      | 44px calendar event controls; semantic, Space-operable More controls; narrow month grids scroll locally rather than shrinking targets |
| A11      | Notes/reminder controls wrap at 320px with 200% text                                                                                  |
| A12      | Authority acknowledgement required before entering reorder mode                                                                       |
| A13      | 44px row date/action targets; completion remains aligned with the title                                                               |

The two reproduced PR regressions (A03/A12) have permanent passing regression
coverage. The audit remains a historical record rather than being rewritten to
remove its original failures.

## Local performance evidence

Production-mode E2E build, 5,000 synthetic tasks, 1,757 matching Today tasks,
1280×800 Chromium, 4× CPU slowdown, fresh contexts, median of three runs at
`9393a59` (subsequent cursor/completion refinements validated separately):

| Metric                           | Audited PR | After refactor |
| -------------------------------- | ---------: | -------------: |
| First usable row                 |    6,988ms |        3,356ms |
| Open task detail                 |    3,177ms |          264ms |
| Initial DOM elements             |     25,217 |            451 |
| Longest initial main-thread task |   ~2,250ms |        1,456ms |
| Decoded initial JavaScript       |   ~1.596MB |        1.394MB |

The initial query now exposes 200 of 1,757 matches, rather than waiting for all
matches. This is a first-usable-list comparison, not equal-time complete-query
throughput. After explicitly loading **all 1,757 matches**, the measured DOM still
contained only **450 elements / 15 task rows**. JavaScript figures are decoded
sizes, not compressed transfer sizes. Synthetic fixture generation contributes
to the remaining long task; these are not real-device or authority-network SLOs.

Local evidence: `~/.local/state/tasknotes-ui-audit/2026-09-09-pr156/architecture/`
(`performance.json`, `all-pages-windowed.png`).

## Acceptance coverage and remaining work

Permanent tests cover retained/discarded/failed drafts, stale parsing and refresh
callbacks, duplicate and alternating completion intent, rejected arrangement,
partial/failed/cancelled cursors, complete-scope rank placement, nested Escape,
modal Tab/focus return, Scratchpad/calendar semantics, 44px targets, 200% text,
and large-list DOM budgets while scrolling, paging, and returning from detail.

Final local validation:

- **590 unit tests / 106 files** passed; application/domain coverage gates passed.
- **61 browser tests** passed, including eight fully mocked relay tests; one
  intentional duplicate-matrix case skipped.
- **4,982 TaskNotes conformance checks** passed, one skipped; the local mdbase
  v0.3 collection oracle passed.
- Typecheck, lint, formatting, production build, and production-mode E2E build
  passed. The generated development manifest was restored afterward.

No LAB daemon, live collection, production deployment, or canonical checkout was
used for testing.

Remaining work is explicit:

- Collection initialization and search/relationship projections still hydrate
  the repository's in-memory collection cache. Authority-paged search and bounded
  collection hydration require a further repository-level redesign.
- Kanban, project/calendar presentations, and explicit reordering are not yet
  generally windowed. A07 is mitigated for ordinary lists, not a claim that every
  collection surface now scales without bounds.
- The common command/overlay primitives are established, but not every older
  editor, interaction, and mutation has been migrated into them.
- Native keyboards, VoiceOver/TalkBack, real outages, large media, and deployed
  network performance still require device/authority acceptance testing.

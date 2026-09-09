# TaskNotes UI, UX, and performance audit

## Verdict

**Do not treat green happy-path tests as release acceptance.** The broader audit
found 13 actionable issues, including capture data loss, missing mutation/error
feedback, inaccessible modal behavior, and large-list stalls. Two reproduced
issues were introduced by PR #156: a delayed capture callback can discard the
next draft, and failed manual-order activation still enters reordering mode.
Most other findings already exist on `main`.

The PR substantially improves large-list performance relative to `main`, but
neither version handles a large active list comfortably on the throttled test
machine. This is not evidence that the refinement made performance worse.

## Scope and method

- Audited PR #156 at `d2e4890`, including `main` at `2d1dcdc`.
- Built and served production-mode E2E bundles on loopback ports 4297 and 4298.
  The baseline was a disposable archive of `origin/main`, not a modification to
  the canonical checkout.
- No LAB service, live collection, production deployment, or real task data was
  used. Interactive audit browser contexts blocked non-loopback requests.
- Exercised Today, capture, task details, search, Scratchpad, view management,
  settings, Upcoming, Calendar, and Kanban.
- Ran 32 axe scans: eight surfaces × two viewport widths (390/1280) × light/dark.
  Included WCAG 2.2 target-size checks as well as the existing 2.0/2.1 checks.
- Additional probes covered Escape handling, tab traversal, draft dismissal,
  200% text scaling at 320px, tiny controls, delayed callbacks, rejected writes,
  query failure, duplicate completion, and search truncation.
- Performance comparison: three runs per build per dataset, 4× CPU slowdown,
  fresh browser contexts, 1280×800 viewport, loopback network, 50/500/5,000
  synthetic tasks. Timings below are local lab measurements, not field INP or
  an estimate of hosted-collection network latency.
- Four temporary regression probes intentionally failed their desired-behavior
  assertions, confirming the corresponding bugs. They were removed from the
  normal suite and retained with the audit evidence.

Existing validation remains useful: 558 unit tests, 43 UI browser tests, and
eight mocked relay integration tests passed. Those tests do not cover all the
failure paths identified here. Android/iOS builds and the PR smoke check passed
after correcting stale test expectations.

## Findings

### A01 — P1: Escape dismisses the whole capture while a child popup is open

**Reproduced in browser; also reproduced on `main`.**

1. Open Add task and type `Important task #wo`.
2. Wait for the suggestions list.
3. Press Escape to dismiss suggestions.
4. The entire capture sheet closes. Reopening gives an empty draft.

The same happens with the Scheduled calendar open. The child dismisses itself,
but the window-level Escape listener also closes the parent.

**Source:** `src/components/global-task-capture.tsx:67–71`,
`src/components/task-capture.tsx:250` and
`src/components/tasknotes-controls.tsx:788–811`.

**Fix direction:** Give the innermost overlay ownership of Escape, respect
handled/default-prevented events, and add nested-popup regression tests. Merely
adding another independent global Escape listener will not solve it.

### A02 — P1: Capture dismissal destroys an unsaved draft without recovery

**Reproduced in browser; pre-existing, now more consequential because phone
lists use the modal composer as their primary capture path.**

Type a task, close the sheet, reopen: the draft is empty and no discard
confirmation appeared. Close, backdrop click, and Escape all unmount the
composer. Close also remains enabled during an in-flight write, so the new
"draft survives failed writes" guarantee only holds while the sheet stays open.

**Source:** `src/components/global-task-capture.tsx:97–123`; draft state lives in
`src/components/task-capture.tsx`.

**Fix direction:** Retain a collection-scoped in-memory UI draft across dismissal
or confirm discarding dirty content. Keep pending writes and their eventual
failure visible/recoverable. Do not implement a second durable task replica.

### A03 — P1: A late create-refresh callback can discard the next draft

**Reproduced with a deferred callback; introduced by PR #156. Merge blocker.**

1. Create a task with Keep adding tasks off.
2. Authority acceptance clears the input, but the view-refresh callback is slow.
3. Type a second task into the still-open composer.
4. Resolve the first task's refresh: its callback closes the sheet and destroys
   the second draft.

The probe expected the dialog to remain open; it disappeared. The callback
captures the previous `keepAdding` value as well, so changing that preference
while the first operation is pending does not protect the next draft.

**Source:** `src/components/global-task-capture.tsx:135–139`,
`src/components/task-capture.tsx:320–350`.

**Fix direction:** Scope post-create close behavior to a submission/composer
version and close only if no newer draft exists. Alternatively finish the close
lifecycle before allowing a new draft. Do not let a background refresh own the
lifecycle of a later user interaction.

### A04 — P1: Task-row completion has no pending guard or local failure feedback

**Double submission reproduced with a deferred mutation; error-feedback gap
confirmed by source review. Pre-existing.**

Two clicks while a completion write is pending produce two calls. The repository
serializes toggles, so the second queued toggle can reopen the task. A slow
connection therefore encourages exactly the repeat tap that undoes completion.

The ordinary row also ignores the returned promise. List/Search callbacks use
`void toggleTask(...)`, unlike the task-actions menu's guarded error path. A
rejection is not turned into an actionable row error.

**Source:** `src/components/task-row.tsx:23,75–89`,
`src/app/search-screen.tsx:88`,
`src/storage/mdbase-repository.ts:454–478`.

**Fix direction:** Give completion an explicit async/pending contract, disable
repeat submission for the same task/occurrence, and provide visible retry/error
feedback. Preserve the authority-acceptance boundary.

### A05 — P1: Search presents query failures as no matches or stale results

**Reproduced with a failing-query hook result; pre-existing.**

`useTasks` returns an error, but Search destructures only tasks/loading. A
failed query with no prior results renders "No tasks matched." A failed query
with previous results can leave those results on screen without an error notice.
Users cannot distinguish missing tasks from an unavailable computer/collection.

**Source:** `src/app/search-screen.tsx:21–25,95`,
`src/app/repository-context.tsx:574–625`.

**Fix direction:** Render an operation error and retry action. If retaining
previous results, label them as stale rather than presenting them as the current
query's answer.

### A06 — P1: The mobile property sheet claims to be modal but focus escapes

**Reproduced with browser keyboard traversal; pre-existing.**

Open a row's Scheduled property at 390px. After tabbing through Clear value,
focus reaches the document body, Skip to content, Search, View options, capture,
and background task rows. The sheet still has `aria-modal="true"`; the root is
not inert. There is no focus trap or document-scroll lock.

**Source:** `src/components/task-property-editor.tsx:106,126–150`.

**Fix direction:** Use the shared modal infrastructure on phones: isolate the
background, trap focus, lock background scrolling, and restore focus to the
trigger. Retain an appropriate nonmodal popover behavior on wide layouts.

### A07 — P1: Large active lists still block the main thread for seconds

**Measured; pre-existing and improved by this PR.**

With 5,000 fixture tasks, Today renders 1,757 matching task rows and about
25,217 DOM elements. At 4× CPU slowdown the PR's median first-row readiness is
6.99s, with roughly 2.25s single long tasks. Opening detail takes a median 3.18s.
A separate sample measured about 0.82s for collapsing a section.

The repository consumes all saved-view pages before returning the normalized
execution. The UI renders every row. CSS `content-visibility` helps layout/paint
but does not eliminate React work, DOM allocation, or all the row controls.
Collapsed sections retain their mounted children.

**Source:** `src/storage/mdbase-repository.ts:785–817`,
`src/app/views-screen.tsx:2070,2277`,
`src/components/task-list-section.tsx`, and `.task-row` in `src/styles.css`.

**Fix direction:** Bound initial work, support incremental/paged execution where
the provider contract permits it, and virtualize large list bodies while keeping
focused rows and keyboard reordering accessible. Profile row invalidation and
callback stability. Do not solve search truncation by making every query fetch
all records.

### A08 — P2: Search silently caps results at 300 and reports an exact count

**Reproduced in browser; pre-existing.**

Search `Review demo task` in the 5,000-task demo. The UI says `300 TASKS`, renders
300 rows, and offers neither a truncation warning nor a way to load more.
Browse-fields suggestions are likewise inferred from this limited task sample,
not the entire collection.

**Source:** `src/app/search-screen.tsx:24,79–80,109–189`.

**Fix direction:** Return/display total-count or has-more information and expose
pagination. At minimum say "300+ tasks"/"Showing the first 300" rather than an
apparently complete answer. Query field facets independently when needed.

### A09 — P2: Scratchpad outline autocomplete has invalid ARIA semantics

**Reproduced by axe in both themes and both viewport sizes. Present in the
recent Scratchpad changes on `main`, not introduced by this refinement.**

Outline textareas expose `aria-expanded` without a role that supports it. Axe
reports `aria-allowed-attr` with critical impact on draft-task, note, and trailing
capture textareas. This is an accessibility finding, not a security severity.

**Source:** `src/app/scratchpad-screen.tsx:2384–2394`,
`src/components/outline-textarea.tsx`.

**Fix direction:** Implement a coherent, supported autocomplete/combobox pattern
for multiline entry, or remove unsupported state while retaining valid popup
relationships. Verify behavior with screen readers, not just attribute presence.

### A10 — P1: Month-calendar events are too small to target; More links have invalid ARIA

**Reproduced by axe in both themes and viewport sizes; existing calendar issue.**

At 390px, interactive event dots measure **5×5px**, with insufficient safe space
to neighboring targets. Desktop event targets are approximately **88×17px**.
The generated `+ more` anchors expose `aria-expanded` without a supporting role.
Axe flags `target-size` (serious) and `aria-allowed-attr` (critical).

**Source:** FullCalendar integration in `src/app/full-calendar-view.tsx:271–310`,
event controls around line 530, and `.full-calendar-event-content` responsive
rules in `src/styles.css:8629–8690`.

**Fix direction:** On phones, make a day-sized target open a usable agenda rather
than requiring precise taps on individual dots. Normalize More controls to valid
button/disclosure semantics. Keep event access available by keyboard and screen
reader.

### A11 — P2: Task details fail 200% text reflow on a narrow phone

**Reproduced on both the PR and `main`.**

At a 320px viewport with the root text size doubled, task-detail document width
becomes **343px**. The Notes Write/Preview row forces Preview past the right edge.
Additional reminder controls also have over-wide intrinsic layouts when exposed.
Normal-size 320px screenshots alone did not catch this.

**Source:** `.notes-field-heading` / its button group in
`src/styles.css:3136–3167`; inspect reminder layouts under the same scaling.

**Fix direction:** Allow action groups to wrap/stack with growing text, remove
inflexible min-content assumptions, and add text-scaling coverage alongside the
existing viewport matrix.

### A12 — P2: Failed manual-order activation still enters reordering mode

**Reproduced with a rejected source read; introduced by PR #156.**

When Reorder tasks must enable manual sorting and that operation fails, an error
appears but so does Done reordering. No handles exist because manual order never
became active. The header claims a mode the list has not entered.

**Source:** `src/app/views-screen.tsx:460–510,968–969`.

**Fix direction:** Make sort activation report success/failure and only enter
arrangement after success. Existing saved manual order can enter the mode without
another source write.

### A13 — P2: Common task-list actions miss the app's touch-target contract

**Measured in browser; pre-existing sizing, relevant to the newly explicit
clickable date labels.**

The first phone row's Scheduled and Due buttons are about **21.5px high**;
its task-actions trigger is **40×44px**. These fall short of the documented
44-point minimum. Normal-list axe scans did not flag these because the WCAG
minimum/spacing exceptions are not identical to the app's stronger target-size
contract.

**Source:** `src/styles.css:691,1091,1130` and task-row metadata buttons.

**Fix direction:** Provide deliberate touch hit areas without overlapping the
title/completion actions. Test actual bounds and adjacent targets, not just font
size or visual padding.

## Performance comparison

Medians of three runs, 4× CPU slowdown. Dataset size counts all fixture tasks;
rendered Today rows are 18, 176, and 1,757 respectively.

| Fixture tasks | Main: first row | PR: first row | Main: open detail | PR: open detail |
| ------------- | --------------: | ------------: | ----------------: | --------------: |
| 50            |           680ms |         678ms |             197ms |           177ms |
| 500           |         1,291ms |       1,190ms |             402ms |           346ms |
| 5,000         |        11,127ms |       6,988ms |           6,121ms |         3,177ms |

At 5,000 tasks, observed DOM count falls from 39,245 to 25,217. Median longest
initial task falls from about 5.67s to 2.25s. Decoded JS resource bytes after the
initial settle are about 1.590MB on main and 1.596MB on the PR: approximately a
6.4KB increase, not a meaningful explanation for the stalls. These are decoded
resource sizes, not compressed transfer costs.

Fixture generation contributes to startup timings. The large DOM and observed
long tasks still justify a separate bounded-rendering investigation, but these
numbers must not be represented as real-device or real-authority benchmarks.

## Recommended order

1. Fix A03 and A12 before merging the PR: both are reproduced regressions.
2. Fix capture lifetime/Escape and completion/error handling (A01–A06) before
   calling the everyday task workflow dependable.
3. Address calendar and Scratchpad accessibility and text scaling (A09–A11).
4. Give large-list rendering and search completeness an explicit performance
   budget and a coordinated pagination strategy (A07–A08).
5. Finish the touch-target pass (A13) without inflating every row indiscriminately.

## Evidence and limitations

Raw JSON, screenshots, standalone browser probes, comparison runs, and the four
intentionally failing component probes are retained locally at:

`~/.local/state/tasknotes-ui-audit/2026-09-09-pr156/`

No production files or real user data are in those artifacts. The ordinary test
suite does not include the intentionally failing probes.

Not tested here: physical-device haptics, actual iOS/Android overlay keyboards,
VoiceOver/TalkBack operation, real hosted/connected-computer outages, notification
delivery, large PDF/media files, or network-throttled production performance.
No claim of complete accessibility conformance follows from the axe scans.

The smoke failure that initially blocked #156 was not a new runtime regression:
two relay tests expected the old navigation order and the old clear-before-save
composer. Their assertions were updated, all eight mocked relay tests passed
locally, and the remote smoke check subsequently passed. The findings above are
separate from that CI correction.

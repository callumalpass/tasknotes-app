# Large-collection performance

## Status

Three architectural increments, not 50k-record product acceptance. The target is a
responsive web/native TaskNotes at up to 50,000 records, without a durable local
task replica. Incremental refresh, session indexes, metadata-only browsing,
bounded document retention, and authority-side body matching are implemented.
Task-list views can now open before the full metadata index. Background indexing,
broad non-list views, and browser/mobile acceptance still need measurement.

## Reproducible baseline

Run from the repository root after `pnpm install --frozen-lockfile`:

```sh
pnpm bench:collections
# Optional overrides:
PERF_SIZES=10000,50000 PERF_ROUNDS=7 \
  PERF_OUTPUT=benchmarks/results/latest.json pnpm bench:collections
```

The harness uses the real `MdbaseTaskRepository`, model decoding, filtering,
sorting, and refresh code. Its **synthetic authority** serializes and parses every
response, paginates at 1,000 records, and counts requests, records, JSON bytes,
and body bytes. It does not measure Connect's real query engine, relay latency,
HTTP compression, React rendering, browser long tasks, or device memory.

The dataset is 10k/50k **task records**, all open, each with a 2,048-byte body,
unique ID/path/title, and one of 50 tags. This stresses resident task volume; it
is not a mixed-type, large-attachment, recurrence-heavy, or long-body benchmark.
Fixture generation is outside the measured interval. Seven sequential samples
are taken, except initialization, first rare search, and the first list after
mutation, which have one sample. First detail and accepted edit also have one
sample. The initial reports had no explicit GC. The second-increment harness
exposes GC and samples process heap before initialization, after initialization,
and after queries. GC runs outside timed operations. Heap deltas exclude fixture
allocation but include mock bookkeeping; they are not isolated browser heaps or
mobile memory budgets. There is no explicit warm-up. The first list sample builds
ordering; its cost is visible in the recorded p95 (with seven samples, p95 is
just the maximum). The first rare search follows common searches, not a fresh
process. These are directional measurements, not browser latency SLOs.

Baseline source is `c27e1e6`. To run the same harness against it without reverting
working code:

```sh
# This temporary source directory must not already exist.
test ! -e .performance-baseline && mkdir .performance-baseline
git archive c27e1e6 src | tar -x -C .performance-baseline
PERF_REPOSITORY_MODULE=../.performance-baseline/src/storage/mdbase-repository \
  PERF_REVISION=c27e1e6 PERF_OUTPUT=benchmarks/results/baseline-bounded-loading.json \
  pnpm bench:collections
# Remove only this generated source directory after the run.
rm -r .performance-baseline
```

Do not run the ordinary test suite with the temporary baseline source present.
Both saved runs use the locked Connect beta.96 / task model rc.11 dependencies,
Node v22.22.0, on an AMD Ryzen 9 7940HS. An initial exploratory run accidentally
used the canonical checkout's older installed dependencies; it was discarded
and the baseline was rerun with a clean, locked worktree installation.

## Measured results

Median milliseconds, except the explicitly single-sample operations. Source
reports: [baseline](../benchmarks/results/baseline.json) and
[incremental](../benchmarks/results/incremental.json).

| Operation                              | 10k before | 10k after | 50k before | 50k after |
| -------------------------------------- | ---------: | --------: | ---------: | --------: |
| Initialize (one sample)                |     541.40 |    546.34 |   2,801.25 |  2,623.17 |
| Unchanged refresh                      |     719.82 |      0.25 |   4,200.20 |      0.24 |
| List, limit 0                          |      10.82 |     <0.01 |      85.63 |     <0.01 |
| List, limit 300 (warm median)          |      10.71 |      0.03 |      92.15 |      0.02 |
| Common body search, limit 300          |      11.06 |      0.17 |      87.77 |      0.26 |
| First rare body search (one sample)    |       9.29 |     12.29 |      74.38 |     68.20 |
| Subsequent rare body search            |       8.89 |      6.98 |      77.13 |     42.72 |
| Refresh after one body edit            |     725.21 |      0.87 |   3,981.12 |      2.51 |
| First list after mutation (one sample) |      12.05 |      1.93 |      73.31 |      9.61 |

The 50k first list costs about 10.7 ms; **0.02 ms is the warm median**, not a
cold-first-query claim. Rare body search remains linear and can exceed the
50 ms long-task threshold. The 10k first rare search regresses by about 3 ms in
this sample. An intermediate design cached normalized bodies: it made warm rare
search faster but doubled body-text retention and worsened the 50k first search
to 136 ms. That design was removed. Only small searchable metadata is cached;
body normalization is transient and skipped when metadata satisfies the query.

Deterministic transfer comparison at 50k:

| Operation          | Before                                     | After                                  |
| ------------------ | ------------------------------------------ | -------------------------------------- |
| Initialize         | 51 requests / 50k records / 122.55 MB JSON | Unchanged                              |
| Unchanged refresh  | 51 requests / 50k records / 122.55 MB JSON | 2 requests / 0 records / 24.19 KB JSON |
| One-record refresh | 51 requests / 50k records / 122.55 MB JSON | 3 requests / 1 record / 26.90 KB JSON  |

Bytes are uncompressed serialized payload, not on-the-wire bytes. Actual
unchanged-refresh latency includes two authority round trips; the submillisecond
number above is not an end-to-end network promise. The fixture's changed-path
selection itself scans its in-memory records; this is not evidence of an
indexed query plan in the actual provider.

## Second increment: summaries, documents, and search evidence

Fresh runs of the expanded harness are saved as
[baseline-bounded-loading](../benchmarks/results/baseline-bounded-loading.json)
and [bounded-loading](../benchmarks/results/bounded-loading.json). The former
uses original source `c27e1e6`, not the first increment. Browsing/search feature
detection exists only in the benchmark, so old implementations exercise the
same user intent through their original `list()` API.

| 50k operation / resource                  | Original baseline rerun | Second increment |
| ----------------------------------------- | ----------------------: | ---------------: |
| Initialize, ms                            |                2,790.40 |         2,379.27 |
| Startup JSON, MB                          |                  122.55 |            19.65 |
| Startup body bytes                        |             102,400,000 |                0 |
| Retained heap delta after initialize, MiB |                  157.37 |            60.39 |
| Retained heap delta after queries, MiB    |                  157.77 |            64.65 |
| Unchanged refresh, ms                     |                4,180.07 |             0.22 |
| Warm list300, ms                          |                   63.47 |             0.03 |
| Common body search, ms                    |                   64.65 |            51.29 |
| First rare body search, ms                |                   50.41 |            63.46 |
| Subsequent rare body search, ms           |                   52.94 |            63.54 |
| One-record refresh, ms                    |                4,344.83 |             3.18 |
| First list after body mutation, ms        |                   92.05 |             0.02 |

At 10k, initialization is 590.79 → 518.77 ms and retained initialization heap is
32.25 → 12.97 MiB. Startup still makes 51 requests for 50k records: fewer bytes,
not bounded first paint. The first list costs 11.93 ms at 50k; 0.03 ms is warm.

Search is a **tradeoff**, not a universal latency win. Relative to the first
increment's in-memory body scan, common search regresses from 0.26 to 51.29 ms in
this synthetic harness, and it now needs authority access. A first uncached
detail also needs a point read (one record / 2,378 JSON bytes / 2,048 body bytes
in this fixture). Repeated details use the bounded cache. A metadata edit after
that read uses one accepted write, retains the exact body, and transfers one
complete response. Offline uncached documents/search fail explicitly rather
than showing fabricated bodies or empty results.

The simulated authority performs body scanning in the benchmark process, so
search timings include its JavaScript scan and are **not client main-thread or
real engine timings**. Common body search returns one 1,000-record evidence
page (447,724 JSON bytes), while the rare search returns one record (613 bytes).
Neither transfers body text. Required body-only tokens are combined with AND;
otherwise a conservative OR predicate plus local metadata/evidence matching
preserves AND-across-fields semantics. Nonmatching records can be discarded
only after authoritative evidence or query completion. Application ordering is
preserved even when authority order differs.

Important worst cases remain: common searches with a different application
ordering can consume many evidence pages, and a query whose every token occurs
somewhere in metadata can still have a broad OR predicate. The all-open fixture
has aligned path ordering and does not demonstrate these cases are fast. Local
metadata search scans yield cooperatively after an 8 ms budget, checked every
128 candidates; browser long-task measurements remain necessary.

### Explicit document boundary

`TaskSummary` has no `body`. `Task` requires an observed complete body.
`listSummaries()` serves browsing, calendar identity, archive candidates,
reminders, and scratchpad linking. `search()` returns summaries plus matching
body tokens, not snippets derived from unloaded text. `get()` hydrates complete
documents/revisions on demand. Explicit complete `list()` calls batch exact
paths, but application browsing does not use that API.

Hydrated documents use a session LRU capped at 64 entries and 8 MiB of
conservatively counted UTF-16 body/frontmatter text. This bounds the cache, not
an actively edited large document or an explicitly requested complete result
array. Simultaneous point reads coalesce; eviction never removes metadata.
Missing body fields fail closed; an observed empty string is valid. Metadata
mutations hydrate first and preserve the exact Markdown body. Incremental and
full refresh invalidate document hydration, including body-only changes.
Accepted-write and lifecycle guards prevent stale reads from replacing current
state. Query resources abort superseded/unmounted searches.

### Real-engine contract probe

```sh
MDBASE_TEST_CLI="$(command -v mdbase)" \
  node --test scripts/body-search-projection.node-test.mjs
```

This opt-in probe uses only its own temporary `[test]` filesystem collection,
not a daemon or user collection. The installed Rust CLI beta.98 confirmed
boolean `file.body.lower().contains(...)` projections with neither top-level nor
nested `file.body` text returned. The JavaScript reference engine rejected
`.lower()` and was not used as authority evidence. The CLI probe is not a live
Connect beta.96 SDK/relay test, provider latency benchmark, or LAB acceptance.
Without `MDBASE_TEST_CLI`, ordinary release tests explicitly skip this probe.

## Third increment: workspace readiness before the metadata index

The application requests `initialize({ deferTaskIndex: true })`. Configuration
opens first; saved-view catalogue and page queries no longer depend on the task
index. Ordinary `initialize()` retains complete initialization for callers that
explicitly need it. Index consumers share one lazy, atomic load and await it:
statistics, search, relationships, metadata lists, creation/path allocation, and
materialized-occurrence resolution never treat a partial index as complete.

The first view records bounded metadata hints (up to 512 tasks). Opening or
completing an ordinary visible task can hydrate its exact path without waiting
for the full index. Unknown IDs still await authoritative index completion before
being reported absent. Accepted writes remain protected against a delayed index
snapshot. Authoritative snapshots retire stale path hints, and hydration checks
identity before allowing a hinted path to modify a replacement record. Suspension
cancels the old load; a resumed load cannot be overwritten by old responses. Metadata decoding yields cooperatively rather than occupying
one uninterrupted collection-sized JavaScript turn.

Auto-archive startup runs through its existing serialized/error-reporting queue
without blocking workspace readiness. The provider still launches background
refresh and reminder reconciliation. These can load metadata concurrently with
the first view; this change removes a dependency, not all background traffic.
Rolling maintenance and pending deletion recovery retain their correctness
requirements. Calendar/kanban still execute complete view scopes, and operations
requiring global identity/path knowledge may still wait for indexing.

### First-page benchmark

Reports: [startup-baseline](../benchmarks/results/startup-baseline.json), source
`dca721a`, and [startup-deferred](../benchmarks/results/startup-deferred.json).
Both use the same synthetic authority and default task-list fixture with
2,048-byte bodies. One fresh sample per size, GC outside timing. The measurement
runs configuration → catalogue → first 200-row page, then requests statistics to
measure deferred indexing separately. It does **not** run React, concurrent app
background activities, network latency, or real provider query planning.

| Metric                           | 10k before | 10k after | 50k before | 50k after |
| -------------------------------- | ---------: | --------: | ---------: | --------: |
| First repository view page, ms   |     604.41 |     27.60 |   2,710.25 |     13.86 |
| Records fetched before that page |     10,200 |       200 |     50,200 |       200 |
| Requests before that page        |         13 |         3 |         53 |         3 |
| JSON before that page, MB        |       3.93 |     0.105 |      19.46 |     0.105 |
| Subsequent index wait, ms        |       1.65 |    568.00 |       2.60 |  2,859.96 |

The three isolated foreground requests are description, catalogue, and view page.
The full index work has moved off that path, **not disappeared**. Background
requests in the actual application can overlap the first page, so these byte and
request counts are not a browser first-paint traffic claim. The lower 50k
first-page time reflects sample/JIT variation, not a larger collection being
intrinsically faster. No p95 or mobile SLO is established by these single samples.

```sh
PERF_STARTUP_OUTPUT=benchmarks/results/startup-latest.json \
  pnpm exec vitest run --config benchmarks/vitest.config.ts benchmarks/startup.perf.ts
# To compare: use the temporary source procedure above with dca721a,
# PERF_REPOSITORY_MODULE and PERF_REVISION=dca721a.
```

Regression coverage deliberately stalls metadata loading while a real
`RepositoryProvider` and `ViewQuerySession` show the first task. Repository tests
also verify first-page/no-index traffic, edits versus delayed snapshots, shared
index loading, failed-load retries, lifecycle cancellation, and no duplicate
initial snapshot for authorities without changes.

## Architecture implemented

### Change-feed reconciliation instead of periodic full downloads

The repository retains the **pre-snapshot** `describe.changeCursor`, then uses
ordinary provider-neutral `changes` operations on refresh. It deduplicates
changed paths, including both sides of a rename, and queries those paths in
batches of 100 using the existing type/provider mappings and effective
frontmatter. Deletions and records leaving task types are reconciled from the
absence of rows. It does not rely on an event containing a complete task.

A cursor reset, changed description/schema/configuration, unknown resource/event,
more than 500 distinct paths, or more than 10 change pages causes an authoritative
full snapshot. These bounds are provisional until real-provider measurements
establish a crossover point. Authorities not advertising `changes` retain the
full-snapshot path. Ordinary transport failures do **not** trigger extra full
queries or hide known unavailability. View-source-only events invalidate views
without downloading tasks.

All pages are staged before commit. The cursor advances only after a successful
commit. A failed schema rebuild remains pending. Session writes made while a
snapshot is in flight protect both old/new paths from stale replacement or
resurrection. Captured lifecycle signals prevent pre-suspension pages from being
committed after resume. Unchanged task objects retain their identity, and full
snapshot comparison no longer JSON-stringifies note bodies.

### One session index for repeated queries

`ConnectedTaskIndex` replaces repeated list sorting and body concatenation. It
owns path lookup, lazy reusable ordering, searchable metadata, and rolling-parent
membership. Mutations invalidate ordering; revision-only hydration preserves
unchanged task identity. Empty requests do no enumeration; limited queries stop
when enough matching tasks are found. Filtering, token substring matching,
archive/status behavior, tie ordering, and slice-limit semantics are retained.
The index stores no durable records and does not open folders or IndexedDB.

### Data changes are distinct from connectivity changes

Repository subscribers can distinguish status-only notifications. The application
updates connectivity without invalidating every list/view or scheduling archive
work. Legacy subscribers/producers can omit event metadata and still get the
conservative data-change behavior. Auto-archive skips collection enumeration
when disabled, coalesces bursts, and performs a trailing reconciliation when
changes arrive during an active scan. Refresh `scanned` now means fetched records
examined, not the total cached collection size.

## Remaining work: holistic 50k acceptance

These are implementation/verification requirements, not claims already met.

| Surface                      | Remaining architectural work                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cold opening and detail      | Task-list first pages no longer await the metadata index; verify browser first paint, concurrent background traffic and real authority scheduling. Replace remaining global-index prerequisites with bounded identity/path lookups where appropriate.                                                                                |
| Search                       | Authority body evidence and cancellation are implemented. Validate real query plans, cold/typed-query latency, Unicode matching, broad predicates, and application/authority ordering mismatches. Bound evidence transfer for these worst cases.                                                                                     |
| Calendar                     | Replace `useTasks(limit: 50_000)` identity loading with bounded range/identity lookups. Preserve recurrence exceptions, occurrence identity, and drag mutations.                                                                                                                                                                     |
| Scratchpad                   | Replace repeated `list(limit: 50_000)` link resolution with batch identity/path lookup; page note/image history at the authority. Review the current 1,000-row history queries and per-document reads for truncation and N+1 traffic.                                                                                                |
| View editing                 | Remove the whole-task enumeration for property suggestions; use bounded provider completions.                                                                                                                                                                                                                                        |
| Recurrence and relationships | Rolling-parent membership is now indexed, but per-occurrence resolution still constructs full task relationship indexes. Introduce reusable ambiguity-aware identity/occurrence indexes; benchmark many recurring parents and a date rollover.                                                                                       |
| Archive and reminders        | Archive-disabled work is now bounded. Enabled archive still enumerates tasks; use status-specific candidates/incremental observation. Audit native reminder reconciliation and preserve mdbase authority ownership of delivery.                                                                                                      |
| Views and rendering          | Lists already have windowing; verify grouped/manual lists, kanban columns, calendars, and search DOM bounds at 50k. Bound saved-view execution caches, avoid repeated cumulative-page copying, and narrow data-change invalidation (currently still conservative/global). Preserve explicit completeness before manual-order writes. |
| Lifecycle/concurrency        | Exercise reconnect gaps, reset/rebuild, grant changes, rapid tab switching, accepted writes during full/delta reads, and external changes on both authority types.                                                                                                                                                                   |

Provisional acceptance goals:

- First useful screen requests at most its initial 200-row page plus small
  configuration/summary data, not all task bodies.
- An unchanged refresh transfers zero task records and does no full-task
  enumeration; a small edit scales with the changed paths, not collection size.
- Typing, completion, navigation, and scrolling do not incur app-owned main-thread
  tasks over 50 ms; target under 16 ms for warm local interactions.
- Establish and enforce a measured mobile heap budget, including query caches,
  search, images, stale data, and repeated collection switching. No unlimited
  body/view-result retention.
- Measure 1k/10k/50k fixtures, all-task and mixed-note distributions, short/long
  bodies, custom mapped types, archives, recurrence, relationships, and scratch
  images. Use p50/p95, first-content time, long tasks, heap plateau, requests,
  bytes, and rendered-row counts. Keep data integrity assertions in every case.
- Test browser and throttled/mobile profiles on both hosted and connected LAB
  authorities before declaring 50k acceptance. No production test data.

## Verification and current limits

Third increment: **686 tests across 121 files**, 42 Node release/probe tests,
typecheck, lint, formatting, production build, benchmark typecheck, and the
before/after first-page benchmark passed. Startup regressions cover a stalled
index with enabled auto-archive, edits before index completion, shared loads,
failed-load/schema rediscovery, lifecycle cancellation, and stale path hints.

Validated the second increment: 677 tests across 119 files, 42 Node release/probe
tests with the Rust CLI probe enabled, `pnpm typecheck`, `pnpm lint`,
`pnpm format:check`, `pnpm build`, and both expanded benchmark runs passed.
Additional regression tests cover body omission, exact-body mutation preservation,
point-read coalescing, bounded retention/eviction, delayed reads versus accepted
writes/disposal, body-only refresh invalidation, cross-field search matching,
out-of-order evidence pages, incomplete/failed evidence, and cancellation.

Regression tests cover query parity, index invalidation, no-work empty requests,
status-only application invalidation, disabled/coalesced archive reconciliation,
change paging/bounds/resets, create/edit/delete/rename/type removal, view events,
failed/partial refresh, lifecycle cancellation, and accepted-write races against
both full and incremental snapshots. Existing repository contract tests retain
mapped-provider and mutation behavior coverage.

Live LAB verification is **blocked**: `mdbase-env lab up` timed out after 10 seconds
again when retried after disk space was freed. Preflight did not complete, so no LAB test fixtures were created,
no browser was started, and no staging/production actions were taken. No real
Connect, browser, Android, or iOS performance result is claimed here.

# Large-collection performance

## Status

First architectural increment, not 50k-record product acceptance. The target is a
responsive web/native TaskNotes at up to 50,000 records, without a durable local
task replica. Incremental refresh and session indexes are implemented. Bounded
cold loading, body search off the main thread/provider-side, and browser/mobile
acceptance remain necessary.

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
mutation, which have one sample. There is no explicit GC or warm-up. The first
list sample builds ordering; its cost is visible in the recorded p95 (with seven
samples, p95 is just the maximum). These are directional measurements, not
statistically established browser latency SLOs.

Baseline source is `c27e1e6`. To run the same harness against it without reverting
working code:

```sh
# This temporary source directory must not already exist.
test ! -e .performance-baseline && mkdir .performance-baseline
git archive c27e1e6 src | tar -x -C .performance-baseline
PERF_REPOSITORY_MODULE=../.performance-baseline/src/storage/mdbase-repository \
  PERF_REVISION=c27e1e6 PERF_OUTPUT=benchmarks/results/baseline.json \
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
| Cold opening and detail      | Split task summaries from complete editable documents in the repository port. Show the first saved-view page without awaiting a full task-body scan. Fetch details/revisions on demand with a bounded session LRU. Never represent an unloaded body as an editable empty string.                                                     |
| Search                       | Provider-side indexed search with mapped fields and preserved substring semantics, or a bounded worker pipeline if authority semantics cannot express it. Avoid retaining all bodies plus another normalized copy. Cancel superseded queries and measure first-query as well as warm latency.                                        |
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

Validated this increment: 660 tests across 116 files; `pnpm typecheck`,
`pnpm lint`, `pnpm format:check`, `pnpm build`, and both benchmark runs passed.

Regression tests cover query parity, index invalidation, no-work empty requests,
status-only application invalidation, disabled/coalesced archive reconciliation,
change paging/bounds/resets, create/edit/delete/rename/type removal, view events,
failed/partial refresh, lifecycle cancellation, and accepted-write races against
both full and incremental snapshots. Existing repository contract tests retain
mapped-provider and mutation behavior coverage.

Live LAB verification is **blocked**: `mdbase-env lab up` timed out after 10 seconds
during this run. Preflight did not complete, so no test fixtures were created,
no browser was started, and no staging/production actions were taken. No real
Connect, browser, Android, or iOS performance result is claimed here.

# TaskNotes SDK beta.123 migration

## Summary

Migrated only `/home/calluma/worktrees/consumers/tasknotes-app-sdk-beta123`,
branch `sdk/beta123`, from application baseline `4c12fac` and Connect beta.119
to exactly `0.1.0-beta.123`. All four direct `@mdbase-dev/*` dependencies and
three pnpm overrides are pinned; the pnpm lockfile and installed dependency tree
agree. No canonical checkout changes, push, PR, deployment, or live collection
mutations. Disk checked before/after: 178/177 GiB available.

Commits before this evidence/report commit:

- `e7f92bb`: repair benchmark result-type narrowing and capture beta.119 baseline.
- `b7722ce`: dependency and lockfile upgrade.
- `e32f2c6`: SDK adoption and regression coverage.

## Replacements and retained domain ownership

| Before                                                                               | After / justification                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two app-owned 100-path loops, equality-disjunction CEL builders, and `chunkPaths`    | `readMany` for changed-path metadata and complete-list hydration. SDK owns escaping, batching, page draining and ordered found/missing/error results. Explicit `batchSize: 100, concurrency: 1` preserves serial authority pressure. Every batch failure is checked before publication; failed rows never become deletions.                                                                                                                          |
| Explicit abort listener calling `pages.return()` on a paused saved-view generator    | Deleted the listener and removal hook in `src/storage/mdbase-repository.ts`. Actual SDK tests prove paused/in-flight abort releases the cursor once without another iterator call. Ordinary iterator disposal remains. On this baseline, `src/application/view-query-session.ts` owns generic disposal, while the SDK-specific workaround was in the repository; its `close()`/restart/error `return()` calls remain valid for any `TaskRepository`. |
| Hand-built declared-assignee-list `asFile()` predicate                               | `linksTo(mappedField, personPath, { multiple: true })`. Authority link resolution remains collection-wide. Index-aligned link/target projections and domain assignment mapping remain unchanged.                                                                                                                                                                                                                                                     |
| Raw event-ID lists and runtime payload-path parsing                                  | Switch on typed `kind` and typed identities. Unknown/malformed/resource/schema/gap/reset events still force reconciliation. Both hosted and local view variants avoid unnecessary task reads. Custom test and benchmark emitters use SDK normalization.                                                                                                                                                                                              |
| An authority description request and JSON schema comparison on every routine refresh | SDK `describe()` cache; cached object identity skips JSON comparison. Polling invalidation is observed before replacement records are decoded. Failed/unloaded indexes and full reconciliation use fresh descriptions.                                                                                                                                                                                                                               |

**Deliberate partial retention:** JSON comparison remains on actual description
refetches, not cache hits. SDK `schemaGeneration` is a local invalidation counter,
not an authority schema revision, and TTL expiry does not increment it. Removing
this comparison would either miss unannounced configuration changes or rebuild
a 50k-task index on every unchanged refetch/view invalidation. Real-SDK tests cover
unchanged TTL expiry, changed configuration without an event, schema polling, and
view-only invalidation. No second expiry timer, watcher, or payload-copy cache
was introduced.

Kept all RMW/write locks, mutation coordinator, command/attachment journals,
revision reads, provider-model discovery, local-write-vs-read guards, atomic
snapshot staging, cursor advancement policy, and bounded document cache.
TaskNotes does not use SDK record sessions; the follow-refresh scheduler upgrade
needs no app adaptation. No result cap was added to globally ordered searches or
complete indexes: that would change completeness/order semantics.

## Files and size

- Dependencies: `package.json`, `pnpm-lock.yaml`.
- Production: `src/storage/mdbase-repository.ts`, `src/storage/mdbase-change-plan.ts`.
- Existing tests: `src/storage/mdbase-incremental-refresh.test.ts`,
  `src/storage/mdbase-repository.test.ts`, `src/storage/mdbase-task-documents.test.ts`.
- New tests: `src/storage/mdbase-change-plan.test.ts`,
  `src/storage/mdbase-sdk-description.test.ts`, `src/storage/mdbase-sdk-pagination.test.ts`.
- Fixtures: `src/test/mdbase-fixture.ts`, `src/test/sdk-description-fixture.ts`.
  The hydration fixture exercises the real SDK batching implementation; the
  description fixture uses the actual SDK cache over a synthetic authority.
- Benchmark harness: `benchmarks/large-collections.perf.ts`, `benchmarks/startup.perf.ts`.
- Evidence: four `benchmarks/results/sdk-beta123-*.json` files linked below.
- This report: `docs/sdk-beta123-migration.md`.

Diff against `4c12fac`, excluding this report:

| Scope                   | Added lines | Deleted lines |
| ----------------------- | ----------: | ------------: |
| Production              |         136 |           108 |
| Tests and fixtures      |         401 |            42 |
| Benchmark harness       |          33 |            14 |
| Benchmark JSON evidence |        1726 |             0 |
| Dependencies/lockfile   |          36 |            35 |

Not a net-line-count reduction: batching/cursor/expression ownership moved to the
SDK, while error validation, safe cache sequencing and integration tests were added.

## Verification

Final commands/results:

- `pnpm install --frozen-lockfile`: passed; all installed mdbase packages beta.123.
- `pnpm verify`: passed (format, TypeScript, ESLint, coverage, conformance, manifest
  generation/validation and production build).
  - Release Node tests: 41 passed / 1 optional Rust probe skipped. Subsequently
    `MDBASE_TEST_CLI="$(command -v mdbase)" pnpm test:release`: **42 passed / 0 skipped**,
    using only the probe's disposable temporary collection.
  - Unit/coverage: **753 tests / 129 files passed**.
  - Coverage statements/branches/functions/lines: **75.18/67.76/72.78/78.07%**.
  - Application coverage: 71 tests / 11 files, **83.08/71.87/79.50/86.77%**.
  - Domain coverage: 183 tests / 31 files, **82.37/72.09/86.66/86.76%**.
  - TaskNotes conformance: **4982 passed / 1 skipped / 0 failed**.
  - mdbase v0.3 collection oracle: passed.
- `TASKNOTES_DEV_PORT=4273 TASKNOTES_APP_URL=http://127.0.0.1:4273
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4273 pnpm test:e2e`: **123 passed / 5 skipped**,
  desktop/mobile, 4.4 minutes. Default port 4173 was occupied; its server was not
  reused or stopped. Existing viewport-specific skips remain. Vite reported two
  ResizeObserver-loop warnings during large-list scrolling, without test failures.
- `pnpm bench:collections`: **2 scenarios / 2 files passed**, before and after,
  including benchmark TypeScript checking.
- `pnpm test:e2e:connect --list`: **blocked**, exit 1: isolated dogfood requires
  `MDBASE_CONNECT_DOGFOOD_COLLECTION_DIR`; no scenario or browser started.
  Candidate-B is excluded by the default suite without its session token.
- Not run: live production smoke (tests deployed production, not this worktree),
  live LAB acceptance, Android/iOS builds; no deployment or native changes.
- `git diff --check`: passed. Development-generated manifest restored with
  `pnpm manifest`; no test-origin change retained.

The first benchmark invocation exposed pre-existing TypeScript errors because
read/update fixture results may also be view-source documents. Narrowing `body`
fixed compilation without altering task workload. Baseline JSON's stale hardcoded
beta.96/model rc.11 labels were corrected to the actually installed beta.119/model
rc.15; the harness now reads the Connect pin from `package.json`.

## Before/after benchmark

Evidence: [collection before](../benchmarks/results/sdk-beta123-before.json),
[collection after](../benchmarks/results/sdk-beta123-after.json),
[startup before](../benchmarks/results/sdk-beta123-startup-before.json),
[startup after](../benchmarks/results/sdk-beta123-startup-after.json).
Before application revision: `4c12fac`; after: `e32f2c6`.
Node v22.22.0, Ryzen 9 7940HS, 10k/50k tasks, 2048-byte bodies, seven rounds
except existing single-sample cases. After harness enables real SDK description
caching and understands SDK `file.path in [...]` alongside historical disjunctions.
It retains serialized synthetic authority responses and existing workload/assertions.

| Median milliseconds                 | 10k before | 10k after | 50k before | 50k after |
| ----------------------------------- | ---------: | --------: | ---------: | --------: |
| Initialize (one sample)             |     594.39 |    585.27 |    2829.15 |   2702.06 |
| Unchanged refresh                   |       0.25 |      0.07 |       0.23 |      0.02 |
| Single-record refresh               |       0.62 |      0.63 |       3.24 |      3.02 |
| Common body search                  |      17.57 |     15.06 |      55.43 |     50.74 |
| Warm rare search                    |      11.52 |     12.64 |      59.76 |     58.21 |
| First usable view page (one sample) |      30.05 |     26.49 |      14.05 |     18.74 |

Deterministic counters (same at either collection size unless stated):

- Unchanged refresh: **2 requests / 0 rows / 24,837 bytes → 1 / 0 / 91** while
  the description cache is warm. Real cache expiry still incurs a describe request.
- One-record refresh: **3 requests / 1 row / 25,497 bytes → 2 / 1 / 969**.
  Synthetic event serialization now includes normalized fields and retained raw
  data; these bytes are logical fixture JSON, not wire/compressed transport bytes.
- 50k initialization: unchanged **51 requests / 50k rows / 19,649,994 bytes**;
  zero body bytes. Initialization heap **62.27 → 62.26 MiB**, post-query heap
  **66.54 → 66.11 MiB**.
- First view page: unchanged **3 requests / 200 rows / 105,701 bytes**;
  zero body bytes. Deferred 50k indexing **2631.34 → 2777.94 ms** (one sample).
- Search and accepted-write transfer counts unchanged. Common/rare search p95
  remains approximately 81/60 ms at 50k after migration.

The reproducible request reduction is the useful result. Timing improvements
and regressions are sample variation, not latency guarantees. This harness does
not measure real query engines, network/relay, browser paint, or native memory;
no 50k product acceptance or mobile performance improvement is claimed.

Re-run after:

```sh
PERF_REVISION=$(git rev-parse HEAD) \
PERF_OUTPUT=benchmarks/results/sdk-beta123-after.json \
PERF_STARTUP_OUTPUT=benchmarks/results/sdk-beta123-startup-after.json \
pnpm bench:collections
```

## Behaviour and risks / wave B

- No intended user-flow, domain mutation, storage topology, or visual changes.
  Null assignee values gain the helper's defensive guards. Hosted view events now
  get the same bounded task-refresh treatment as local view events.
- ReadMany batches are not an atomic authority snapshot. Serial batching and
  existing local-write/lifecycle fences remain; query hydration still carries no
  authoritative revision, so editing always obtains one through `read()`.
- ReadMany accepts no timezone option. Removed path-only predicates do not use
  time expressions; full index, search, and saved views retain runtime timezone.
  Custom authority behavior depending on timezone during row materialization
  would need separate qualification/API support.
- Cache invalidation is not background observation. TaskNotes retains lifecycle/
  explicit/periodic polling, fresh full recovery, and fallback for authorities
  without changes. Actual refetch comparisons protect schema/binding correctness.
- Beta.124 authority feature discovery could replace manual operation/support
  checks, but must preserve older-authority fallback and provider-neutral UI.
- Revision-bearing batches could populate editing revisions and remove the
  post-hydration revision-only read. Keep fresh desired-state reads, identity
  validation, RMW locks and exact mutation recovery.
- Metadata queries could reduce full-index/search/completion payloads; TaskNotes
  still needs its model mappings, ordering and recurrence metadata.
- `files.stat` could simplify future ad hoc attachment-path lookup. Existing file
  operations already use known descriptors; no proven whole adapter removal.
- Stable authority schema identity, if offered later, could remove the remaining
  refetch-only JSON comparison. Local `schemaGeneration` alone cannot do that.

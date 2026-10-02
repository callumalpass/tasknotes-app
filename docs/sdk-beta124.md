# Connect beta.124 / TaskNotes Wave B

## Changes and boundaries

- Exact beta.124 pins for every `@mdbase-dev/*` dependency/override. Removed
  beta.123's startup-cancellation patch and fixed the fixture's metadata
  `queryPages` overload. This upgrade is a separate, independently green commit.
- Scratchpad history/image hydration uses `readMany` only after positive
  `read-many-documents-v1` discovery. Batches contain at most 100 paths with
  concurrency four. Unsupported authorities retain four-slot point reads.
  Advertised failures are errors, not downgrade probes; missing candidates do
  not become a silently complete history snapshot.
- Task hydration retains the returned content/revision pair in the existing
  64-document / 8-MiB cache and reindexes changed metadata. Revisionless legacy
  hydration still rereads before editing; fresh desired-state reads remain.
  Accepted local writes win over delayed hydration.
- Lazy full-index scans negotiate `query-metadata-v1`, selecting the union of
  configured provider mappings, user fields and legacy aliases. The selection
  returns only present literal key/value pairs, preserving missing versus null
  and keys containing punctuation. Ordinary full-frontmatter queries remain the
  unsupported-authority fallback. Query revisions never certify later bodies.
- No Scratchpad lifecycle, RMW locks, mutation coordinator, command journal,
  storage-provider branching or durable task replica changes. A batch projection
  is not cast into an exact-source `RecordDocument`.

## Checks

Upgrade-only `pnpm verify`: 138 files / 921 tests passed, plus both layer
coverage gates, release tests, conformance, formatting, typecheck, lint and build.

Wave B `pnpm verify`: 139 files / 931 tests passed. Application coverage:
84.47% statements / 76.12% branches / 88.01% lines. Domain coverage:
80.87% statements / 71.10% branches / 85.32% lines. Portable conformance:
4,982 passed / one skipped, plus the mdbase collection oracle. The oracle also
executes the selected-field CEL expression with the real JS evaluator; native
metadata/batch negotiation is exercised with the actual beta.124 SDK and
synthetic authority responses.

Desktop/mobile Playwright: **125 passed / five skipped**, 8.2 minutes, using
worktree-local Vite on port 4184 because the default 4173 was already occupied.
Live Connect dogfood is **blocked** without
`MDBASE_CONNECT_DOGFOOD_COLLECTION_DIR`; candidate-B acceptance is **blocked**
without `MDBASE_CANDIDATE_B_SESSION_TOKEN`. No LAB services, live collections,
deployment or canonical checkouts were mutated.

## Benchmarks

`pnpm bench:collections` passed at 10,000 and 50,000 tasks, before and after,
with seven samples for repeated operations (initialization, hydration and edits
are single samples). Added explicit `hydrate300` / `editHydrated` scenarios and
an independent 205-history-note / 150-image scenario. Evidence is under
`benchmarks/results/sdk-beta124-*.json`.

Primary before/after uses **the same beta.124 SDK and qualified synthetic
producer**, comparing the upgrade-only repository (`eda46fd`) against Wave B.
The additional beta.123 baseline and legacy-authority control are retained
separately. The double serializes/parses responses after output shaping, so
logical payload counts include the narrow envelope rather than client stripping.

| Qualified scenario                                    |                   Before |               After |
| ----------------------------------------------------- | -----------------------: | ------------------: |
| 10k index response bytes                              |                3,931,994 |  3,121,084 (-20.6%) |
| 50k index response bytes                              |               19,649,994 | 15,639,884 (-20.4%) |
| 50k index requests / body bytes                       |                   51 / 0 |              51 / 0 |
| First saved-view page requests / rows / bytes         |        3 / 200 / 105,701 |           unchanged |
| 50k deferred startup total response bytes             |               19,456,669 |          15,568,779 |
| Hydrate 300 tasks (authority type selection + bodies) |               6 requests |          6 requests |
| Edit a retained hydrated task                         | 2 requests / 4,767 bytes |           1 / 2,395 |
| History + images: point reads / document batches      |                  357 / 0 |               1 / 5 |
| History + images: total requests                      |                      360 |                   9 |

Synthetic timing samples, not network or real provider CPU: 10k initialization
670.65 → 731.38 ms; 50k initialization 3,804.10 → 3,461.88 ms; history
20.09 → 32.07 ms. There is **no consistent latency speedup claim**. The fixture
implements selection and serialization in JavaScript and request latency is
zero; the deterministic wins are transferred bytes and eliminated revision
requests. The legacy control retains the original 10k/50k index byte/request
counts and the old history read path.

Reproduce a qualified after run:

```sh
PERF_AUTHORITY=qualified PERF_REVISION=wave-b \
  PERF_OUTPUT=/tmp/tasknotes-after.json \
  PERF_STARTUP_OUTPUT=/tmp/tasknotes-startup-after.json \
  PERF_SCRATCH_OUTPUT=/tmp/tasknotes-scratch-after.json \
  pnpm bench:collections
```

For the paired before run, temporarily extract the upgrade-only
`src/storage/mdbase-repository.ts` into
`src/storage/benchmark-before-repository.ts`, set
`PERF_REPOSITORY_MODULE=../src/storage/benchmark-before-repository` and separate
output paths, then remove that temporary file. Use identical fixture/harness
code and `PERF_AUTHORITY` for both runs. Omit `PERF_AUTHORITY` for the conservative
legacy control.

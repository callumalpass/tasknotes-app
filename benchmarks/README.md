# Collection performance evidence

Run `pnpm bench:collections` (or `rpnpm run bench:collections` on the shared
builder). Defaults remain 10,000 and 50,000 records, 2 KiB Notes bodies and seven
samples per repeated operation. `PERF_SIZES`, `PERF_ROUNDS` and the three
`PERF_*_OUTPUT` variables select diagnostic runs and report destinations.

Each collection size is an independent Vitest case with the existing
300-second timeout. Previously both sizes shared one test's 300-second budget:
a run of the unmodified benchmark on the shared VM took 291.19 seconds for that
case (303.92 seconds for all three benchmark files), consistent with the
reported load-sensitive timeout. Dataset duration and seeding time are now
recorded, and phase progress identifies where an interrupted run stopped.
Reports contain completed datasets; the Vitest exit status determines success.

`results/sdk-beta206-upkeep.json` captures the upkeep working tree on the shared
AMD EPYC 9B14 builder: 30.90 seconds for 10k and 234.70 seconds for 50k. Seeding
accounts for 1.82 and 3.69 seconds respectively. The diagnostic temporarily used
a larger timeout to obtain complete measurements, but both datasets finished
within the unchanged 300-second bound. No larger timeout is retained.

## Comparing historical results

The beta.119/beta.124 reports in `results/` used the legacy repository and a
synthetic JSON-serialized authority on an AMD Ryzen 9 7940HS. For example,
`results/sdk-beta124-after.json` recorded 3,461.88 ms initialization and 85.80 ms
median body search for 50,000 records. Those values are not current SDK or Core
performance baselines.

Commit `58554662` replaced the old repository/authority benchmark with
`NextTaskRepository`, the SDK client and `MemoryReplica`; `4366d505` later
migrated that harness to the current SDK API. The repository's token-by-token
body-search query and full-snapshot `refresh()` were already present before
`58554662`; the retired repository's body cache and incremental refresh are not
what this benchmark measures now. The current harness
meters real CBOR frames and SDK records. `MemoryReplica` hashes serialized
Markdown for revisions and filters/sorts the collection again for each query
page; common search tokens visit many pages. That synthetic work is included
in elapsed time, although no native Core query engine, Noise, relay or network
is involved. CPU, SDK pin, deterministic work counters and measurement scope
are recorded with every run. Shared VM load also changes elapsed time.

Compare reports only with matching authority, repository, SDK, dataset and
machine context. These tests establish repository behavior and synthetic work;
they do not establish live collection or Core latency. No production query,
SDK, sample count or dataset was changed to fit the timeout.

## Search, task list and Scratchpad at 10,000 records

Run `rpnpm run bench:view-interactions`. The first round warms the fixture and
the report uses the median of seven rounds. Search measures four successive
prefixes, with and without two earlier words. The SDK client runs against
MemoryReplica, and the work counters capture response frames and bytes. The
task-list case applies a Bases filter and sort to 10,000 tasks, then groups the
8,000 matches into 250 groups. The Notes case opens the first Scratchpad
history page from 10,000 notes with 2 KiB bodies, then loads an older page and
formats its first preview.

For a browser trace, run `pnpm dev:e2e` and then
`node scripts/bench-view-interactions.mjs http://127.0.0.1:4173`. This uses a
10,000-task demo for Search and Inbox, and the local SDK protocol fixture with
10,000 notes for Scratchpad. It checks visible search results, bounded list
mounts, history pagination and the expanded note body. Timings include a
paint opportunity and the Search debounce. These are post-open interactions.
The production cold-open apply stage in #602 is outside these measurements.

## Task detail, filter editor and bulk selection at 10,000 tasks

Run `rpnpm bench:editor-interactions`. Each of three runs seeds a fresh demo
repository. The React/jsdom benchmark opens the last task in navigation order,
makes ten successive title changes and flushes on blur. It opens the
view editor's Filter section and applies a Bases expression for each of tags,
contexts, projects and status, checks the match counts, and changes the view
name five times. It then registers the 10,000 rows, selects 32 in succession
and applies a priority change through the bulk command. Each run reports the
number of navigation IDs read during typing, preview evaluations during
renaming and elapsed milliseconds. Timings include the demo repository and
React updates. Browser painting, native sync and network latency need separate
measurements.

# Spike: reading tasks through the `tasknotes.task` contract view

Question: should TaskNotes read and write tasks through Connect's
contract-keyed API (`queryContract`, `getContract`, and `create`/`update`
with `contract`) instead of reading raw records and normalising them with
`@tasknotes/model`?

Everything here runs the vendored SDK's real `runtime.wasm` (native Core) in
Node. `harness.ts` opens it as an unsynced local collection on an in-memory
SQLite database through the SDK's own app-storage adapter
(`AppWasmRuntime.openUnsyncedConsuming`, `SqliteIndex`, `appSqlHost`). The
browser app does the same over OPFS in a Worker; only the SQLite VFS
differs. The shipped runtime refuses the older plain in-memory store
(`rt_open`: "app artifact requires trusted rt_app_open; MemStore open
refused"), so the SDK's `MemoryReplica` test stand-in is not used anywhere.

Collections are set up with the same documents the app writes
(`buildTaskNotesMdbaseResources({ profiles: ["core-lite"] })`). The app side
of each comparison uses the app's own code: `nextTaskCatalog`,
`nextTaskSummary` and `nextTaskDocument`.

No network, account, LAB, staging or production service is involved.

## Running

The files are named `*.spike.ts`, so `pnpm test` never runs them.

```sh
cfg=scripts/spikes/contract-view/vitest.config.ts
pnpm exec vitest run --config $cfg smoke         # one record end to end
pnpm exec vitest run --config $cfg budget        # claim 1, ~3 minutes
pnpm exec vitest run --config $cfg fidelity      # claims 2-6
pnpm exec vitest run --config $cfg old-producer  # claim 7
pnpm exec vitest run --config $cfg bad-record    # side finding, see below
SPIKE_SIZES=2000,10000 SPIKE_RUNS=5 pnpm exec vitest run --config $cfg timing
```

| File                    | What it measures                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `harness.ts`            | Opens the real runtime, writes the TaskNotes model documents, seeds raw records.                                                                                                                             |
| `budget.spike.ts`       | Bisects the record size and page size at which `queryContract` refuses a page with `too_large`/`contract_projection_budget`.                                                                                 |
| `fidelity.spike.ts`     | Seeds awkward records other clients write and prints, per record, the stored frontmatter, the app's `Task`, the contract projection with its issues, and `getContract`'s answer. Then tries contract writes. |
| `old-producer.spike.ts` | Renames the three contract methods in outgoing frames, so the real runtime answers them as a producer without them would, and prints what the SDK raises.                                                    |
| `timing.spike.ts`       | Full read of N tasks: the app's ordinary pages + `readSummary` against `queryContract` pages.                                                                                                                |

`bad-record.spike.ts` is a side finding, not part of the contract question:
it loads the app's real `NextTaskRepository` over the runtime and shows that
one task without `dateCreated` makes `listSummaries` throw for the whole
collection.

Typecheck: `pnpm exec tsc -p scripts/spikes/contract-view/tsconfig.json`.

Results and the recommendation are in the pull request that added this
directory.

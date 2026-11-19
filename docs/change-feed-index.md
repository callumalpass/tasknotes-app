# Change-feed task index

Status: implemented, 2026-11-20 (design 2026-11-19). Follows #512 / #513. Supersedes the "Change-feed
reconciliation" section of `large-collections.md`, which described the removed
legacy repository (prior art: `b72c0b3b`, `dedc3079`), not `NextTaskRepository`.

## Problem

`NextTaskRepository` keeps a session index of every task (`ConnectedTaskIndex`,
`this.cache`). It treats that index as disposable:

- Every change-feed batch calls `invalidateRemoteData(true)`. That drops the
  task index (`indexReady = false`), the task model (`initialization = null`),
  the discovered view catalog and every view execution. The next read reloads
  every task and re-runs `describe` and the settings read.
- `refresh()` always reloads every task. It runs on every foreground return (web
  visibility, native resume) and every 60 s on the web.
- `resume()` after `suspend()` starts a new watch from "now" and reloads every
  task.
- A full scan that sees a change event restarts from the beginning.

On a Private collection every read is a relayed round trip to the computer, so
one external edit (or the echo of our own) costs a full pass of the collection,
and a busy vault can keep a scan restarting. #512 was this cost exceeding a
request deadline on a phone.

## What the feed guarantees

`client.watchChanges(onChanges)` delivers `{ changes, cursor, reset }` batches.
Each change is `{ id, path, kind: "put" | "remove", version, entity?, types? }`;
`types` are the record's types (its last ones for a removal), `entity` is
`"record"` or `"file"`. Within one watch object the feed is gap-free: after a
session drop the SDK resumes from its last cursor and delivers the catch-up as
ordinary batches before the watch reports `active` again. A cursor the replica
can no longer serve yields `reset: true`, meaning "re-read what you cache".

Two gaps (fixed in Connect, see below, and feature-detected here):

1. The app cannot read the watch's cursor, so a stopped watch (suspend) cannot
   be resumed: the app must reload everything.
2. Definition (type/contract/schema resource) changes reindex the replica but
   push nothing to watchers. Today the app only notices because it re-describes
   on every record change.

## Design

### 1. Classify each batch (pure function, unit-tested)

`classifyChangeBatch(batch, context)` in `src/storage/collection-changes.ts`
returns:

- `reset`: `batch.reset`, or any change the classifier cannot place.
- `model`: the change touches the TaskNotes settings record (by record id or
  path), or a reserved definition path (`_types/`, `_contracts/`, `_schemas/`).
- `views`: the path ends in `.base` or is under `_views/`, or the record id is a
  known view-source record. (The Obsidian Base type matches `**/*.base`.)
- `tasks`: a map of record id to `put` / `remove` for record changes that may
  affect the task index: the change's `types` include a task type, or the
  record id is in the index, or `types` is absent (older producer). File
  entities never affect tasks.
- `data`: any record change (view executions and other whole-data caches).

### 2. Apply deltas to the index; never discard it for a task change

The repository keeps `pendingTaskChanges: Map<recordId, "put" | "remove">`.

- A batch with `tasks` entries adds them to the pending map and notifies
  listeners through the existing change window. It does not touch
  `indexReady`, the model or the view catalog.
- `ensureIndex()`: if the index is not ready, full load (per-page deadlines, as
  #513). Otherwise, while `pendingTaskChanges` is non-empty, take the whole map
  and apply it: removes delete the entry by record id; puts are read in bounded
  batches (`readMany`, falling back to `find` per id when a batch reports a
  missing record), each request under its own foreground deadline, decoded with
  `decodeSummary`. A record that no longer decodes as a task is removed. A
  record whose portable id changed replaces its old entry. A duplicate portable
  id across two records falls back to a full load, which reports it as today.
- A `ConnectedTaskIndex` reverse map (record id to task id) replaces scans of
  `knownTaskRecords`.
- Local writes accepted while deltas are in flight are protected exactly as in
  the full load (`cache.trackWrites()`).
- A full scan in flight is not restarted by task deltas: changes that arrive
  during it stay pending and are applied when it completes. The scan's result
  is at least as new as the watch position it started from, and every record
  changed since then is reread afterwards.
- More than a bound of distinct pending ids (start with 500) since the last
  apply: drop them and do a full load instead.

### 3. Separate generations

`dataRevision` today fences every derived READ. Split it:

- `modelGeneration`: settings or definition change, reset, re-activation,
  resume, refresh. Retires the model and forces a full index load only when the
  model signature actually changed.
- `viewGeneration`: view-source change, model change, reset. Retires the view
  catalog and discovery passes. A task-only change no longer restarts view
  discovery (a full pass of the collection).
- `dataRevision`: any data change. Still retires view executions, the scratch
  feed snapshot and other whole-data snapshots.

`readCurrentGeneration` takes the generation it is fenced by.

### 4. Refresh, resume and reconnect

- `refresh()`: reload the model. Full index load only if the index was never
  loaded, the model signature changed, or the watch is not `active`; otherwise
  apply pending deltas. `RefreshResult.scanned` counts records actually read.
- Watch re-activation after `stale` (same watch object): the SDK resumed from
  its cursor and delivered the catch-up, so keep the index; reload the model.
  `failed`/`closed` still invalidates everything.
- `suspend()`/`resume()`: keep the index. If the watch exposes `cursor`
  (Connect change below), the new watch starts from it and the catch-up arrives
  as ordinary batches (or `reset`). Without it, behave as today: full load.
- Upstream sync restored on a local replica: keep the current full
  invalidation.

### 5. Definition changes

With the blanket re-describe removed, a definition change made on another
device is picked up by the next model reload (refresh, resume, reconnect,
reset). Once the replica pushes `reset` on catalog changes it is immediate.
TaskNotes' own type and settings writes keep invalidating locally as now.

## Design review amendments (Astra, 2026-11-19)

These override the sections above where they differ.

- **Catch-up pages can skip changes (replica bug).** One replica notification
  stamps all its changes with one version; a 1,000-change page can end inside a
  version group and the next page starts after that version
  (`replica/live.rs` changes paging). Until the replica pages on version-group
  boundaries, the app treats any batch with 1,000 or more changes (the SDK's
  `CHANGES_PAGE`) as a reset.
- **Model identity covers the catalog.** `modelSignature()` adds every type's
  `name`, `path` and `revision` and every contract's `id` and `digest` from
  `describe()`. A definition-only change (for example a task type's
  `match.path_glob`) then forces a full load on the next model reload. An
  explicit `reset` always forces a full load, whatever the signature says.
- **Classification never discards evidence for known or in-scan records.** Any
  change (record or file entity) to a record id the index holds is a task
  candidate. While a full scan is in flight every record change is a candidate.
  The negative `types` filter (types present, no task type) applies only to
  record ids the index does not hold, outside a scan.
- **Pending changes are kept until committed.** The SDK advances its cursor
  before the callback, so the app's pending map is the only copy. One
  reconciliation worker reads candidates and deletes each id from the pending
  map only when its result is committed; a failed or aborted pass leaves them
  pending, and newer arrivals for the same id are not lost. Reads are bounded
  concurrent `find` calls (each with its own deadline and UUID check), not
  `readMany`.
- **Per-record epochs fence every cache publication.** Each record id has an
  epoch bumped when a change for it is enqueued or committed. Any read that
  publishes into the index (`current`, `getSummary`, `remember`, delta
  reconciliation, full scan rows) captures the epoch before its request and
  does not publish if it moved; the change stays pending. Between index workers,
  the repository can retire the whole epoch map under a newer baseline without
  discarding pending changes. A long-lived watch need not keep every past ID.
- **Write bindings outlive index rows.** `knownTaskRecords` (portable id to
  record id) is the write-identity binding and is not cleared when a delta
  removes or rekeys an index row; refusals and identity checks keep using it
  until the write settles. Queued mutations read the native ID captured at
  invocation, not the current owner of its portable ID. On an index miss,
  a mutation looks up the portable ID (or path fallback) at authority
  before treating the task as absent. A failed acknowledgement reread
  re-enqueues its record id.
- **Stale cursors restart the scan.** A full scan that gets
  `invalid_request` with `cursor_stale` or `cursor_expired` discards its
  partial result and starts again (bounded, then the error surfaces as today),
  keeping per-page deadlines. Pending deltas make the restarted result correct.
  This does not guarantee completion under uninterrupted edits (see
  Acceptance).
- **Discovery is cached by view generation.** `listViews()` returns the cached
  catalog (including an empty one) while `viewGeneration` is unchanged. A change
  is view-relevant if its path ends in `.base`, its `types` include a type that
  implements `obsidian.base` (from `describe()` contracts), or its record id is
  a known view source. During discovery, even a pathless removal can retire
  the pass before it publishes a source. A change in the `obsidian.base`
  implementing type set retires discovery without forcing a task scan.
- **Listeners hear about committed deltas.** After a reconciliation pass
  commits a change, listeners get a data notification that does not retire any
  generation, so cached-count consumers (the Today badge) update. A failed
  record read is reported after independent current results commit; only
  failed or superseded candidates need another read. A non-task reread still
  updates that record's conflict state.

### Reconciliation and lifecycle details

- Scan and delta write tracking uses native record IDs, not paths. Reusing a
  deleted task's path does not make the replacement the same record. A summary
  used to check a revision rereads its original ID if its epoch moved; Undo
  also passes the saved native record version to the conditional update. An
  external editor need not write `mobileRevision` to retire an undo. Task submissions
  refuse a model retired during preparation, before capturing a mutation. A
  periodic refresh starts a new model read, but does not retire the write's
  model generation unless the verified signature changes.
- Confirmation runs under the repository's current lifecycle, not the scope
  that captured the write. If the confirmation cannot publish, the affected
  IDs (including unread IDs in the receipt) remain pending for reconciliation.
- A watch's `active` state certifies catch-up even when its first `ready`
  promise rejected. An older catalog without type revisions uses the task
  definition source already fetched for its model signature. An untyped record
  put may introduce a view source. A removal without a tombstone path is
  classified by ID and does not by itself require a scan.
- An index reader waits at most one change notification per attempt and two
  delta passes after model initialization. A required full scan still runs;
  newer deltas stay pending for another reader or change notification. An
  index reconciliation has per-request deadlines, not a deadline over the
  whole pass. An unchanged refresh in a new minute re-executes mounted views
  for clock-dependent results; a new local date also updates date-based counts.

## Connect changes (separate PR, mdbase-connect)

1. SDK: `ChangesWatch.cursor: string | undefined`, the last cursor the watch
   delivered or acknowledged, so an app can stop a watch and later resume with
   `watchChanges(cb, { cursor })`.
2. Replica: page the change feed on version-group boundaries, so a full page
   never ends inside one notification's changes.
3. Replica: a committed catalog change (resource put/delete that changes the
   catalog) raises the feed floor and pushes `{ changes: [], reset: true }` to
   watchers, so caches built under the old catalog are re-read.

Neither needs a TaskNotes release to be safe: TaskNotes feature-detects
`cursor` and treats `reset` as it already must.

## Acceptance

- An unchanged `refresh()` reads zero task records (asserted in a test with a
  request-counting stand-in).
- One external task edit costs one record read, not a scan; a task-only change
  does not re-run view discovery or `describe`.
- Change-feed notifications alone never restart a full scan. (A native
  `cursor_stale` refusal between pages still restarts it: the replica's query
  cursors are invalidated by any collection change, so a multi-page scan,
  more than 1,000 tasks, needs one attempt with no edit between its pages.
  Guaranteed completion under uninterrupted edits needs snapshot-consistent
  paging in the replica; out of scope here.)
- Resume with a cursor applies only the catch-up.
- Reset, model change, duplicate identity, too many pending changes, a full
  catch-up page and watch failure all fall back to the full load.
- An older read that completes after a newer delta does not overwrite it (both
  completion orders, including a late not-found after an identity change).
- A suspend during reconciliation loses no pending change.
- Mounted UI: an unchanged refresh triggers no discovery or task index reads;
  a clock tick may hydrate the visible rows of a mounted view. The Today
  badge updates after a delta commits.
- Existing repository, watch, availability and startup tests keep their
  guarantees (pending writes, identity fences, held edits, lifecycle).

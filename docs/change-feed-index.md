# Change-feed task index

Status: design, 2026-11-19. Follows #512 / #513. Supersedes the "Change-feed
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

## Connect changes (separate PR, mdbase-connect)

1. SDK: `ChangesWatch.cursor: string | undefined`, the last cursor the watch
   delivered or acknowledged, so an app can stop a watch and later resume with
   `watchChanges(cb, { cursor })`.
2. Replica: a committed catalog change (resource put/delete that changes the
   catalog) raises the feed floor and pushes `{ changes: [], reset: true }` to
   watchers, so caches built under the old catalog are re-read.

Neither needs a TaskNotes release to be safe: TaskNotes feature-detects
`cursor` and treats `reset` as it already must.

## Acceptance

- An unchanged `refresh()` reads zero task records (asserted in a test with a
  request-counting stand-in).
- One external task edit costs one record read, not a scan; a task-only change
  does not re-run view discovery or `describe`.
- A scan under a steady stream of task changes completes.
- Resume with a cursor applies only the catch-up.
- Reset, model change, duplicate identity, too many pending changes and watch
  failure all fall back to the full load.
- Existing repository, watch, availability and startup tests keep their
  guarantees (pending writes, identity fences, held edits, lifecycle).

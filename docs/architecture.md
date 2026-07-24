# Architecture

## Purpose

TaskNotes uses one web application across browsers, Android, and iOS without
turning the local collection into browser-owned application state. Each task is
a portable Markdown record governed by the shared TaskNotes model and mdbase
resources.

## Data flow

```text
                         TaskRepository
                               │
                 ┌─────────────┴─────────────┐
                 ▼                           ▼
      IndexedMarkdownRepository       CloudTaskRepository
                 │                           │
       MarkdownCollection              OfflineReplica
                 │                    ┌──────┴──────┐
               Vault                  ▼             ▼
      OPFS / native Documents      IndexedDB   hosted provider
```

The UI depends only on `TaskRepository`. Platform checks stay inside the
`Vault` factory, while cloud synchronization stays inside
`CloudTaskRepository`. Screens use the same list, mutation, completion, status,
and issue vocabulary for every collection location.

## Invariants

1. Local Markdown files are authoritative. A cloud device replica may hold the
   only copy of an unsynchronized write until the hosted authority accepts it.
2. Every persisted task passes through `@tasknotes/model` for mapping and
   mutation semantics.
3. `mdbase.yaml` and `_types/task.md` are generated from the same shared model
   package and live beside the records.
4. Paths crossing the vault boundary are relative, normalized, and may not
   traverse above the collection root.
5. Repository mutations are serialized. A screen can navigate immediately;
   its pending write remains ordered with later operations.
6. Reconciliation is incremental. Unchanged files are identified by path,
   modification time, and size without reading their contents.
7. Invalid external records remain untouched and are omitted from the task
   projection.
8. Cloud mutations update the durable device replica before any network work.
9. Hosted provider credentials remain inside the mdbase client transport and
   are never exposed to application state or UI code.
10. A conflict blocks only its record. Other queued records continue syncing,
    and the user can keep either the device or hosted version.

## Collection lifecycle

On first local open, the vault creates `tasks/` and `_types/`, then installs the
managed mdbase configuration and TaskNotes type when absent. Managed schema
migrations run before records are projected.

When the index is empty, startup performs a full scan. Later startups load the
index first and reconcile the filesystem in the background. A full 10,000-file
parse currently takes about 7.2 seconds on the Android emulator; an unchanged
scan takes about 0.8 seconds.

The in-memory projection supports immediate list and token search operations.
Large Today lists are revealed in 300-row increments so the DOM does not grow
to thousands of rows on initial render.

## Views and navigation

`TaskRepository.listViews()` preserves the provider's saved-view document
shape. A document corresponds to one source file and contains its named views
in source order. The UI derives a flat index only when resolving a stable
`source path + view id` key; the Views catalog keeps source ownership visible.

Today, Upcoming, Calendar, and Projects are managed starter views in the
TaskNotes view document. They use the same catalog, routing, navigation, and
presentation dispatch as collection views while retaining their specialized
task renderers. The managed source carries a version marker so additive starter
view migrations run once and later user edits remain authoritative.

Projects is a relationship view rather than a folder browser. Its saved query
selects collection records with backlinks from active tasks through the
configured projects field. The view engine constructs the backlink index once
per execution. The renderer indexes returned project paths and makes one pass
over the in-memory task projection, avoiding a task-by-project nested scan.
Creating a task from a project injects the project link into the configured
field.

Navigation is a collection-scoped ordered list of view keys stored as a device
preference. Its first item is the home view. Desktop shows the complete list;
mobile shows the first three views and a Views overflow destination. Removing
the final navigation view is disallowed so the collection always has a home.

## Field completion

Task field controls request completions through `TaskRepository.completeField`.
The request describes values or records, the configured field name, optional
target types, and schema enum values. This keeps storage, query dialect, and
link serialization out of React components.

Value completion reads the existing task projection, so contexts, tags, and
other repeated values are immediate. Record completion searches the local
collection, the offline cloud replica, or the relay query endpoint. Relay
requests are debounced, coalesced while in flight, bounded, and cached briefly.
The selected record is persisted as a collection-root wikilink or Markdown
link according to collection configuration.

## Platform storage

`OpfsVault` stores browser collections under OPFS. `CapacitorVault` stores
native collections in the platform Documents directory. Android records are
visible under `Documents/TaskNotes`. iOS enables file sharing and opening
documents in place so the collection can be inspected through Files.

The native Filesystem bridge is intentionally replaceable. If profiling later
shows that directory enumeration or bulk reads dominate startup on physical
devices, a batch-oriented native vault can implement the same contract without
changing collection or UI code.

## Cloud lifecycle

TaskNotes discovers and authorizes through mdbase connect using Authorization
Code with PKCE. The application manifest requires the `tasknotes.task` contract
and provides the portable TaskNotes type document when a collection needs it.
The portal can create a compatible hosted collection during approval, so a new
user does not need to prepare storage first.

After token exchange, the mdbase client supplies a credential-owning sync
transport to `OfflineReplica`. First open downloads collection resources and a
snapshot. Later opens load the persistent IndexedDB replica immediately and
pull changes in the background. A failed pull leaves the collection usable and
marks queued mutations as waiting. Resume pushes local mutations and then
pulls the authoritative change stream.

Native authorization opens the system browser and returns through
`dev.tasknotes.app://auth/mdbase/callback`. Web authorization returns to the
same application origin. The collection and cloud runtimes are separate lazy
chunks, keeping the first-run location screen small.

## Testing boundaries

- Unit tests use an in-memory vault and fake IndexedDB to exercise repository
  reconciliation and mutation ordering.
- TaskNotes conformance runs against the shared model package.
- The generated collection is opened and mutated by the real mdbase v0.3
  TypeScript engine.
- Playwright covers browser CRUD, search, reload persistence, and background
  saves at desktop and phone sizes.
- The cloud browser vertical slice crosses the portal, OAuth server, SDK,
  provider HTTP boundary, offline replica, and conflict UI.
- The Android smoke test crosses the real WebView-to-Filesystem bridge and
  verifies the resulting public Markdown file, notification bridge, process
  restart, and private-use OAuth callback.
- Debug-only benchmark controls create and remove app-owned large-vault
  fixtures, avoiding misleading results from Android scoped-storage ownership.

## Migration from `tasknotes-mobile`

The Expo application remains untouched while this implementation matures.
Migration should proceed in explicit gates:

1. Reach feature parity for the daily task flows selected for the first public
   release.
2. Test iOS on physical hardware and confirm Files integration, backgrounding,
   keyboard behaviour, and safe-area layouts.
3. Add a one-time importer for the Expo app-private collection. The new Android
   public Documents collection is deliberately separate and is not migrated
   implicitly.
4. Exercise the production mdbase cloud service with a private test account and
   deployed TaskNotes manifest.
5. Change the production application ID only after data migration and rollback
   behaviour have been exercised on both platforms.

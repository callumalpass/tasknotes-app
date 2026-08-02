# Architecture

## Purpose

TaskNotes uses one web application across browsers, Android, and iOS without
turning the local collection into browser-owned application state. Each task is
a portable Markdown record governed by the shared TaskNotes model and mdbase
resources.

## Data flow

```text
 React screens and feature components
                 │
        application services ───── durable command journal
                 │                         │
        TaskRepository port         operational IndexedDB
                 │
      ┌──────────┴──────────────┐
      ▼                         ▼
 local Markdown adapter   cloud/relay adapters
      │                         │
 MarkdownCollection        OfflineReplica / hosted API
      │                         │
    Vault                IndexedDB + hosted provider
      │
 OPFS / native Documents
```

Dependencies point inward. Domain modules are pure TaskNotes rules.
Application modules own commands, read-model invalidation, recovery, and the
`TaskRepository` port. Storage, cloud, native, and IndexedDB modules are
adapters. Only collection composition modules construct adapters; React
providers require explicit ports and services.

Screens use the same list, mutation, completion, status, and issue vocabulary
for every collection location. Platform checks stay inside the `Vault`
factory, while synchronization stays inside cloud adapters. Feature renderers
live in focused modules under `app/views` and editor draft/layout concerns are
kept outside the task screen coordinator.

## Commands and recovery

An accepted multi-record update or delayed deletion is written to the durable
application command journal before it is exposed to React. The journal is
operational metadata, not a task authority: local Markdown and the hosted
collection retain the authority described above.

Task update commands are absolute, idempotent patches. Startup replays them in
accepted order and retains the first failed command for an explicit retry.
Deletion intent survives reload throughout its undo window; an expired intent
is committed idempotently. React observes typed command snapshots containing
stable operational error codes and never owns persistence timers.

Repository mutations publish through the required subscription contract.
Query-scoped external-store revisions invalidate task details, relationships,
lists, views, and summaries without placing a provider-wide mutation counter
in React state.

## Invariants

1. Local Markdown files are authoritative. A cloud device replica may hold the
   only copy of an unsynchronized write until the hosted authority accepts it.
2. Every persisted task passes through `@tasknotes/model` for mapping and
   mutation semantics.
3. `mdbase.yaml` and the type providing `tasknotes.task` are canonical
   collection resources. The type may use a custom name and types folder.
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

On first local open, the vault installs the managed mdbase configuration and
TaskNotes type when absent. Each refresh re-resolves the canonical type from
the configured types folder before projecting records. Compatible field,
status, and path changes apply immediately; an incompatible definition is
reported while the last usable projection remains available.

Managed schema upgrades show their affected type path and require user
approval before the type or task records are rewritten. Declining keeps the
canonical files untouched and suppresses repeat prompts until that type
changes.

Startup loads any existing projection before reconciling the filesystem. When
the projection is empty, the application still opens after collection
configuration is ready, then indexes Markdown in bounded background batches.
Each batch commits durable projection rows, yields so foreground mutations can
run, and publishes progressive results. Empty states remain explicitly marked
as incomplete until the scan finishes. Saved views use the streamed task cache
during reconciliation so rendering a partial result cannot trigger a second
full parse.

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

Custom fields also inherit JSON Schema editing semantics. Required fields are
validated on create and update, read-only values cannot be overwritten by the
app, enums use strict selectors, and `date-time` values are stored as RFC 3339
instants.

## Platform storage

`OpfsVault` stores browser collections under OPFS. `CapacitorVault` stores the
default native collection in the platform Documents directory. Android records
are visible under `Documents/TaskNotes`. iOS enables file sharing and opening
documents in place so the default collection can be inspected through Files.

`NativeFolderVault` opens an existing folder selected through the platform file
picker. Android persists a Storage Access Framework tree grant. iOS persists a
security-scoped bookmark and uses coordinated reads and writes. The native
bridge enumerates collection entries in batches, validates every relative path,
and requires the expected selection identifier on each operation so a
repository cannot cross into a newly selected folder. Folder-specific
IndexedDB projections keep cached tasks and navigation preferences isolated.

Users may revoke a grant, move a folder, sign out of a provider, or make a
cloud-backed folder temporarily unavailable. Those failures leave Markdown
untouched and return the user to folder selection.

## Cloud lifecycle

TaskNotes discovers and authorizes through mdbase connect using Authorization
Code with PKCE. The application manifest requires the `tasknotes.task` contract
and provides the portable TaskNotes type document when a collection needs it.
During approval, the generic Connect portal provisions that app-owned type into
the selected hosted collection, so Connect itself contains no TaskNotes
knowledge.

The manifest deliberately requests `full_collection` access as well as naming
the contract. The contract tells TaskNotes which types it can understand and
how their fields map to the portable task model; it is not an authorization
shortcut. TaskNotes also edits Markdown bodies, stores saved views, and keeps a
complete durable offline replica. Contract-scoped access excludes bodies and
fields outside the contract, so it is too narrow for those product features.

After token exchange, the mdbase client supplies a credential-owning sync
transport to `OfflineReplica`. First open downloads collection resources and a
snapshot. Later opens load the persistent IndexedDB replica immediately and
pull changes in the background. A failed pull leaves the collection usable and
marks queued mutations as waiting. Resume pushes local mutations and then
pulls the authoritative change stream. Resource revisions are re-resolved
before records after every sync, so hosted schema changes take effect without
reconnecting.

Native authorization opens the system browser and returns through
`dev.tasknotes.app://auth/mdbase/callback`. Web authorization returns to the
same application origin. The collection and cloud runtimes are separate lazy
chunks, keeping the first-run location screen small.

## Testing boundaries

- A shared `TaskRepository` behavioural contract runs against local Markdown,
  durable cloud replica, and live relay adapters. It covers idempotent open and
  delete, batch ordering, query visibility, capabilities, and subscriptions.
- Application and domain layers have independent coverage floors in addition
  to the whole-program coverage gate.
- Unit tests use an in-memory vault and fake IndexedDB to exercise repository
  reconciliation and mutation ordering.
- TaskNotes conformance runs against the shared model package.
- The generated collection is opened and mutated by the real mdbase v0.3
  TypeScript engine.
- Playwright covers browser CRUD, search, reload persistence, and background
  saves at desktop and phone sizes. Pull requests run the desktop browser
  integration suite, and axe checks onboarding, task editing, views, and
  settings at both configured viewport projects.
- The cloud browser vertical slice crosses the portal, OAuth server, SDK,
  provider HTTP boundary, offline replica, and conflict UI.
- The Android smoke test crosses the real WebView-to-Filesystem bridge and
  verifies the resulting public Markdown file, official
  PushNotifications FCM registration and foreground delivery, process restart,
  and private-use OAuth callback.
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

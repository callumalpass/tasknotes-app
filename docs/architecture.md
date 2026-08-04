# Architecture

## Purpose

TaskNotes runs one React application in browsers, Android, and iOS. mdbase is
the sole durable collection boundary. The selected authority may be hosted or
exposed by a connected computer; that topology is an mdbase concern, not a
TaskNotes storage mode.

## Data flow

```text
React screens and feature components
                 │
         application services
                 │
         TaskRepository port
                 │
      MdbaseTaskRepository
                 │
       MdbaseConnection API
                 │
       hosted or computer authority
```

Dependencies point inward. Domain modules contain pure TaskNotes rules.
Application modules own commands, query invalidation, and the repository port.
The mdbase adapter translates provider-neutral operations and model records.
Only collection composition constructs the adapter; screens do not branch on
authority topology.

## State ownership

- The mdbase authority owns task records, view sources, collection resources,
  scratchpads, and attachment bytes.
- `MdbaseTaskRepository` keeps an in-memory session cache for coherent reads,
  search, optimistic UI coordination, and a last-result fallback during a
  transient request failure. It is discarded when the page closes.
- IndexedDB does not contain a task or file replica. It may retain bounded UI
  intent that is not collection data, currently the 30-second undo window for
  a delayed deletion and attachment-operation coordination.
- Normal creates and updates go directly to mdbase. There is no TaskNotes
  outbox, reconciliation engine, or conflict resolver.

## Invariants

1. A successful mutation means the mdbase authority accepted it.
2. Every persisted task passes through `@tasknotes/model` mapping and mutation
   semantics.
3. `mdbase.yaml` and the type providing `tasknotes.task` are canonical
   collection resources; provider type names and field mappings may vary.
4. Invalid external records remain untouched and are omitted from the task
   projection.
5. Writes to the same logical record are serialized at the repository boundary.
6. Provider credentials remain inside mdbase Connect and are never exposed to
   React state or UI code.
7. The task frontmatter `attachments` list owns attachment membership. Optional
   body embeds own presentation; mdbase file descriptors own binary metadata.
8. Detaching a file is non-destructive. Permanent deletion requires an atomic
   authority-level reference check that is not yet offered.

## Connection lifecycle

TaskNotes discovers and authorizes through mdbase Connect using Authorization
Code with PKCE. Its manifest requires the `tasknotes.task` contract and carries
the portable TaskNotes type pack for collection provisioning. It requests full
collection access because TaskNotes also edits Markdown bodies, manages saved
views, scratchpads, and attachments.

After authorization, TaskNotes constructs exactly one `MdbaseTaskRepository`
from the credential-owning `MdbaseConnection`. Initialization resolves the
collection contract and loads task records. Refresh re-reads canonical mdbase
state. If the authority is unavailable, the current in-memory session can stay
visible, but new writes and a new application session require the authority.

Native authorization opens the system browser and returns through
`dev.tasknotes.app://auth/mdbase/callback`. Web authorization returns to the
same application origin.

## Attachments

Task attachments use collection-relative wiki links such as
`[[Attachments/receipt.jpg]]`. The model validates and normalizes those links
without putting file metadata into YAML. Occurrence tasks inherit references
without duplicating bytes.

Attachment operations use mdbase file capabilities. Bytes are added first and
verified, then task membership is updated. The small operation journal exists
to recover this two-resource coordination; it never becomes a readable file
replica. Inline Notes embeds are optional and independent of membership.

## Views, search, and completion

Saved views remain provider-owned. `listViews` preserves source documents and
`executeView` delegates evaluation to mdbase. The current session caches the
last catalog and execution only to avoid UI discontinuity during a transient
failure.

Task list and value completion use the in-memory session projection. Record
completion queries mdbase, with short-lived in-memory coalescing and debounce.
No durable local index participates in either path.

## Testing boundaries

- The shared repository contract runs against `MdbaseTaskRepository`.
- Unit tests exercise model mapping, direct mutations, unknown-outcome retry,
  views, scratchpads, attachments, reminders, and UI flows with an in-memory
  mdbase protocol fixture.
- TaskNotes conformance runs against the shared model package, and the mdbase
  oracle opens and mutates a generated real collection.
- Playwright uses the mdbase Connect browser fixture and encrypted connector
  operation boundary at desktop and phone viewports. It covers authorization,
  collection selection, task reads and writes, delayed deletion, custom
  contracts, and onboarding accessibility.
- `cap sync`, Android Gradle checks, and the iOS project validate that native
  packaging contains no obsolete filesystem bridge.

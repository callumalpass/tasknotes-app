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

## Scratchpads

Scratchpads and independent `tasknotes-scratch-image` metadata records are typed
Markdown documents owned by mdbase; referenced image bytes are authority-owned
collection files. The repository returns the sole current scratchpad separately
and merges historical notes by `dateConverted ?? dateCreated` with images by
immutable `dateCreated`; `id` remains the deterministic tie-breaker. This makes
recently resumed work return to the newest end of history. Connect exposes no
suitable durable query cursor, so the adapter continues over one bounded
in-memory snapshot of at most 1,000 records of each type and invalidates that
snapshot after mutations.

Each new scratchpad and image metadata record receives a timestamped,
identity-suffixed path that never changes. New records and files stay under one
application-owned hierarchy: notes in `TaskNotes/Scratchpad`, image bytes in
`TaskNotes/Scratchpad/Images`, and their metadata wrappers in
`TaskNotes/Scratchpad/Image Metadata`. Existing paths remain readable by type
and state. Expanded historical-note IDs and collapsed image IDs are optional,
collection-scoped local UI preferences; they contain no record content and do
not participate in repository authority. Drag/drop, file-picker, camera-picker,
and clipboard inputs all enter the same provider-neutral image service. Image upload coordination is bounded
and session-only: bytes are uploaded and descriptor digest, size, media class,
and media type are verified before metadata is created. It does not claim crash
recovery. Removing image metadata never invokes binary deletion. Starting a new
note transitions the sole current capture target in place and creates its
replacement through the same provider-neutral boundary. Resuming a historical
note promotes it without changing its identity, path, content, creation date,
or last history timestamp, and demotes the previous current note with a fresh
`dateConverted`. Keeping the prior timestamp avoids sending a schema-invalid
null deletion; it is replaced the next time that note enters history. Connect does
not currently expose an atomic two-record compare-and-swap, so the adapter uses
revision guards, local write serialization, and a compensating rollback if the
second update fails; duplicate-active detection remains the fail-safe for an
interruption whose rollback cannot complete. The optional `title`
frontmatter field is edited independently from the Markdown body: omitting it
from a save preserves it, while an explicit empty string represents a cleared
title without introducing a schema-invalid null. Starting a
new note preserves an existing explicit title and never derives one from the
first outline item. Existing fixed-path scratchpads remain compatible by type
and state without migration.

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

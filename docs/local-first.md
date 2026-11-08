# Local first use and collection transfer

TaskNotes opens an empty local workspace when there is no signed-in collection.
The normal task, view, Scratchpad and attachment flows use `TaskRepository`.
Connecting remains an explicit action in the sidebar or Collection settings.
Users with an existing selected collection continue to open that collection.

`LocalTaskRepository` commits complete collection checkpoints in IndexedDB.
Each checkpoint includes the TaskNotes type definition, application settings,
canonical task frontmatter and Markdown bodies, view sources, Scratchpad records,
and attachment bytes. A staged mutation becomes visible only after its commit
succeeds. A revision comparison prevents one tab overwriting another tab's work.
A broadcast prompts other tabs to reload the current checkpoint. Clearing browser
data removes this local collection; the interface names that scope explicitly.
Local reminders do not acquire mdbase delivery authority.

`SnapshotTaskRepository` contains the shared domain implementation. The demo is a
subclass that seeds examples; production does not import the demo or its data.
This adapter is intended for first use, rather than a replacement for the SDK's
replication, authorization, receipts, or holds in connected collections.

The pinned beta.162 SDK's anonymous `WasmRuntime.open({mode: "local_only"})`
uses a memory store. Its durable browser app host requires authenticated
bootstrap. Consequently this feature does not claim to promote an anonymous
runtime collection, preserve its collection ID at Connect, or synchronize the
local checkpoint as an SDK replica. New remote collections are created through
Connect and receive the same reviewed import as existing collections.

## Transfer

Collection settings and the desktop sidebar offer Review local tasks. Review
selects a destination type implementing `tasknotes.task`, maps status and
priority values, and supplies custom field values. Completed/skipped status
semantics must agree. The destination model validates and writes its own field
bindings and path policy. Import bypasses templates, recurrence generation and
edit automations, preserving original creation, modification, completion and
history values. Definitions and collection settings are never overwritten.
Type customization changes require a separate schema review.

Before any destination write, the complete immutable payload, destination
record IDs, mutation IDs and attachment paths are committed to a transfer ledger
in the local database. Attachments use an isolated import path. Internal task
IDs, dependency links and Markdown links are rewritten to destination identities.
Scratchpad notes enter history so an existing active note is not replaced.
The original local collection remains available throughout and after transfer.

Transfer requires an exclusive browser Web Lock to prevent simultaneous imports
from two tabs. A reconnect/reload checks the original mutation receipt and
skips confirmed records. Uncertain writes never acquire a replacement identity.
An interrupted binary upload is resolved by the original path and digest; an
unresolved result stays paused. A type change since review also pauses transfer.
These failures retain both the local source and the transfer ledger. Completed
ledgers remain available as provenance. A later review imports newly captured
records and reuses the earlier destination links, without duplicating old tasks
or overwriting destination edits. Retained local tasks and notes are independent
copies; later edits to previously imported records are not synchronized.

The local adapter currently serializes a full checkpoint for each write and
retains source snapshots in transfer ledgers. It is intended for initial capture;
large local collections and long-lived transfer history have not been qualified.
A crash after recording an attempted write but before submitting it can leave a
transfer paused with no receipt. Recovery does not guess or replace that identity.

Validation distinguishes IndexedDB/browser evidence, SDK protocol stand-ins,
and real signed-in collection authority. Local tests do not establish LAB,
native-device, or production synchronization acceptance.

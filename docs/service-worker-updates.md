# Updates in open browser tabs

When a new TaskNotes service worker takes control, supported clients offer
**Reload TaskNotes** and **Later**. Save your changes before reloading. The
prompt does not move focus, clear an editor, or reload automatically. A first
installation does not show an update prompt.

## Tabs running an older build

Tabs opened before the update-prompt code was installed cannot display the new
prompt. TaskNotes does not navigate these tabs, including background tabs:
being hidden does not mean an in-memory capture draft has been saved.

The service worker retains previous app-shell caches so an older tab can still
load its hashed JavaScript chunks. New shell responses take precedence over
older cached responses. Missing assets fall back to the network. Browser cache
eviction and unavailable assets that were never cached can still prevent a
load; retention is not a guarantee of indefinite offline availability.

After a collection cutover, an older SDK may refuse a save and show only its
existing connection error. The SDK cut `2e2ae687`, used only on LAB/next builds
and never shipped to production users, cancels the body of unsuccessful log
responses and maps them to `unavailable`. The server's new human-readable 409
copy therefore does not reach that LAB client's UI. This LAB-only limitation
is separate from production users' legacy Connect update handling. New code
cannot repair an already-running old SDK. The tab keeps its unsubmitted text visible
and copyable; copy that text before manually reloading if it cannot be saved.
No mutation is automatically replayed.

Cache retention does not migrate, delete, or replace collection storage,
credentials, pending writes, or original receipts. Cleanup of retained static
assets is intentionally deferred until it can be done without breaking a
still-open older tab.

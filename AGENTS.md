# TaskNotes app

Read `PRODUCT.md` and `DESIGN.md` before changing user-facing behaviour or
visuals. The application is web-first and packaged for Android and iOS through
Capacitor.

All durable collection access goes through the provider-neutral mdbase
`TaskRepository`. UI and application code must not branch on hosted versus
connected-computer storage. TaskNotes does not open device folders and does not
maintain an IndexedDB task replica; IndexedDB is permitted only for bounded
application state such as a delayed deletion's undo window.

Interface copy uses Lingui; read `docs/translations.md` before changing it. Mark
English source copy with macros, keep generated JSON compiler-owned, and never
translate CSS, identifiers, repository data or authority diagnostics. English is
the only production locale. French is complete but preview-only; preserve its
pre-fallback completeness gate. Catalogue completeness does not authorize release.

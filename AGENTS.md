# TaskNotes app

The application is web-first and packaged for Android and iOS through Capacitor.

All durable collection access goes through the provider-neutral mdbase
`TaskRepository`. UI and application code must not branch on hosted versus
connected-computer storage. TaskNotes does not open device folders and does not
maintain an IndexedDB task replica; IndexedDB is permitted only for bounded
application state such as a delayed deletion's undo window.

The web app's lazy `/import` route reuses its session and selected collection.
`apps/import` supplies the tested import engine and its narrower create-only
`TaskRepository` port. It does not implement the main editor's repository port.
Keep SDK collection access in storage adapters; never create a second mdbase
session for the integrated route. Authentication and reviewed collection setup
remain SDK-owned. The standalone shell is retained for regression testing only.

Both apps use the root pnpm workspace and canonical catalog provision. The
importer's catalog SDK must match the root authenticated production original's
version and integrity; `check:workspace` refuses drift. Keep publisher trust
checks and importer qualification as release gates; native/store approvals remain
separate. Import-engine changes affect the app and must not skip native builds.

Interface copy uses Lingui; read `docs/translations.md` before changing it. Mark
English source copy with macros, keep generated JSON compiler-owned, and never
translate CSS, identifiers, repository data or authority diagnostics. English renders
synchronously; all ten supported locales are production-enabled on this branch.
Use the shared @mdbase-dev/i18n kit and preserve authored-PO completeness before
fallback for every locale. Catalogue completeness does not authorize release.

For user-facing development and after LAB deployment, follow `docs/live-testing.md`.

Private feedback uses the shared `@mdbase-dev/ui/feedback` form; read
`docs/shared-feedback.md` before adding an entry point, a failure hook or an
environment.

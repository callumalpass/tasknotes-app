# Unreleased

- Add bounded startup timing diagnostics for collection opening, bootstrap, setup assessment, the first view query and its first render. Diagnostics contain duration values only, not collection or account details.
- Restore the familiar TaskNotes welcome screen with one Sign in action, automatic approval detection and the signed-in account email when available. Sign-in opens the first-party mdbase popup; collection choices remain in mdbase. The Sign in button uses an arrow rather than an add icon.
- Update the pinned SDK while retaining explicit authenticated build-environment selection. This does not enable People or shared-session features.
- Clarify native Scratchpad recovery limits: opening or listing notes may write, and reloading does not prove recovery of an earlier uncertain operation.
- Older file operations report incomplete metadata if a modification timestamp is unavailable, rather than submitting an incomplete descriptor.
- Opening Scratchpad or starting a new note accepts the portable identity assigned by the native type's creation policy, while retaining the original native record and exact recovery. Existing-note identity checks remain unchanged.
- Create, edit and delete saved Base view sources in native sessions with full-scope edit permission. Read-only and folder-scoped sessions remain non-editable. Changes use the original record identity and complete document readback; deletion confirms the native record is absent before reporting success.
- Editing, customizing or deleting saved views after setup no longer invalidates completed setup or recreates defaults. Readiness follows the collection's current compatible task and view types, including user-defined types.

- Use the registered TaskNotes application name and identifier during explicit sign-in, without migrating earlier protected sign-in data.
- Collections with several task types now show task model settings as read-only, rather than silently editing only the first type.
- TaskNotes setup now installs Scratchpad note and image types. Existing collections can add missing definitions in a separate setup round without replacing their earlier setup history.
- Disable reminder reconciliation in the next app until its timer service is available.
- Previously loaded saved views can show cached rows immediately while refreshing. Cached rows remain marked stale and are cleared when collection data changes.

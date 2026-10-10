# Unreleased

- Create, edit and delete saved Base view sources in native sessions with full-scope edit permission. Read-only and folder-scoped sessions remain non-editable. Changes use the original record identity and complete document readback; deletion confirms the native record is absent before reporting success.
- Editing, customizing or deleting saved views after setup no longer invalidates completed setup or recreates defaults. Readiness follows the collection's current compatible task and view types, including user-defined types.

- Use the registered TaskNotes application name and identifier during explicit sign-in, without migrating earlier protected sign-in data.
- Collections with several task types now show task model settings as read-only, rather than silently editing only the first type.
- TaskNotes setup now installs Scratchpad note and image types. Existing collections can add missing definitions in a separate setup round without replacing their earlier setup history.
- Disable reminder reconciliation in the next app until its timer service is available.
- Previously loaded saved views can show cached rows immediately while refreshing. Cached rows remain marked stale and are cleared when collection data changes.

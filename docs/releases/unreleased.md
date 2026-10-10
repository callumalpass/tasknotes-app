# Unreleased

- Saved view sources show editing controls when the connected session has full-scope edit permission; read-only and folder-scoped sessions remain non-editable. Source deletion uses the exact complete record and confirms its native identity is absent before reporting success.

- Use the registered TaskNotes application name and identifier during explicit sign-in, without migrating earlier protected sign-in data.
- Collections with several task types now show task model settings as read-only, rather than silently editing only the first type.
- TaskNotes setup now installs Scratchpad note and image types. Existing collections can add missing definitions in a separate setup round without replacing their earlier setup history.
- Disable reminder reconciliation in the next app until its timer service is available.
- Previously loaded saved views can show cached rows immediately while refreshing. Cached rows remain marked stale and are cleared when collection data changes.

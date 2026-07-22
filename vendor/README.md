# Vendored packages

These tarballs make the application repository independently installable while
the mdbase Connect and TaskNotes packages are still under active prerelease
development. They are ordinary package-manager artifacts rather than forks of
their source repositories.

The current snapshots were packed from sibling checkouts after their full test
suites passed:

- `../mdbase-connect/packages/protocol`
- `../mdbase-connect/packages/client`
- `../mdbase-connect/packages/sync`
- `../tasknotes-model` (`8b72f61`, with timezone-safe timed recurrence progression)
- `../tasknotes-nlp-core` (`62a0d9d`, including wikilink-safe parsing)
- `../tasknotes-spec`
- `../mdbase`
- `../obsidian-bases-expression`

Refresh a snapshot with `pnpm pack --pack-destination
/path/to/tasknotes-app/vendor` from the relevant package directory, update the
`file:` reference in `package.json` if its version changed, then run `pnpm
install` and the complete verification matrix. Once stable packages are
published, replace these snapshots with registry versions.

# Vendored packages

These tarballs make the application repository independently installable while
the mdbase Connect and TaskNotes packages are still under active prerelease
development. They are ordinary package-manager artifacts rather than forks of
their source repositories.

The Connect SDK snapshots are produced by its `package:consumer` command. Their
filenames include the exact source revision and `mdbase-connect-sdk.json`
records that revision plus a SHA-512 digest for every artifact. Other current
snapshots were packed from sibling checkouts after their full test suites
passed:

- `../mdbase-connect/packages/protocol`
- `../mdbase-connect/packages/client`
- `../mdbase-connect/packages/sync`
- `../tasknotes-model` (`8b72f61`, with timezone-safe timed recurrence progression)
- `../tasknotes-nlp-core` (`62a0d9d`, including wikilink-safe parsing)
- `../tasknotes-spec`
- `../mdbase`
- `../obsidian-bases-expression`

Refresh Connect snapshots from its repository with `pnpm package:consumer --
--destination /path/to/tasknotes-app/vendor`. Update the `file:` references,
run `pnpm install`, and commit the new provenance file with the artifacts and
lockfile. Refresh other snapshots with `pnpm pack --pack-destination
/path/to/tasknotes-app/vendor` from the relevant package directory. Once stable
packages are published, replace these snapshots with registry versions.

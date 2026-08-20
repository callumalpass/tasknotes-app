# Vendored packages

These tarballs keep coordinated prerelease packages installable without sibling
repositories or an unpublished registry release. The revision-stamped mdbase
and Connect SDK artifacts have adjacent JSON provenance manifests containing
their source commit, byte size, and SHA-512 digest.

Current snapshots were packed from sibling checkouts after their full test
suites passed:

- `../mdbase-contracts` (`tasknotes.task` pack `0.3.0-rc.12`, catalog digest
  `sha256:7d48494296728ccb227def0ff37e7a32dea0d02efa86b852e87cd1f46284af9b`)
- `../tasknotes-model` (`0.3.0-rc.11`)
- `../tasknotes-nlp-core` (`62a0d9d`, including wikilink-safe parsing)
- `../tasknotes-spec`
- `../mdbase`
- `../mdbase-connect`

Refresh the core or Connect SDK snapshots from their source worktrees with:

```sh
npm run package:consumer -- --destination /path/to/tasknotes-app/vendor
pnpm package:consumer --destination /path/to/tasknotes-app/vendor
```

After a TaskNotes pack is published by `mdbase-contracts`, refresh its pinned
snapshot with `pnpm contracts:sync`.

Update the corresponding `file:` references and run `pnpm install`. Replace
each snapshot with an exact registry version once that release is published.

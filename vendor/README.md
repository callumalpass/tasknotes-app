# Vendored packages

These tarballs keep coordinated prerelease packages installable without sibling
repositories or an unpublished registry release. The revision-stamped mdbase
and Connect SDK artifacts have adjacent JSON provenance manifests containing
their source commit, byte size, and SHA-512 digest.

Current snapshots were packed from sibling checkouts after their full test
suites passed:

- `../mdbase-contracts` (`tasknotes.task` pack `0.3.0-rc.16`, catalog digest
  `sha256:02aa8b3b…`, see `vendor/mdbase-contracts`)
- `../tasknotes-model` (`0.3.0-rc.13`)
- `../tasknotes-nlp-core` (`62a0d9d`, including wikilink-safe parsing)
- `../tasknotes-spec`
- `../mdbase`

Refresh the core or Connect SDK snapshots from their source worktrees with:

```sh
npm run package:consumer -- --destination /path/to/tasknotes-app/vendor
pnpm package:consumer --destination /path/to/tasknotes-app/vendor
```

After a TaskNotes pack is published by `mdbase-contracts`, refresh its pinned
snapshot with `pnpm contracts:sync`.

Update the corresponding `file:` references and run `pnpm install`. Replace
each snapshot with an exact registry version once that release is published.

# Vendored packages

These remaining tarballs keep unreleased TaskNotes and mdbase packages
installable without sibling repositories. Published packages, including the
Connect SDK and `obsidian-bases-expression`, are installed from npm instead.

Current snapshots were packed from sibling checkouts after their full test
suites passed:

- `../tasknotes-model` (`0.3.0-rc.6`, with string-ranked manual ordering)
- `../tasknotes-nlp-core` (`62a0d9d`, including wikilink-safe parsing)
- `../tasknotes-spec`
- `../mdbase`

Refresh a snapshot with `pnpm pack --pack-destination
/path/to/tasknotes-app/vendor` from the relevant package directory, update its
`file:` reference, and run `pnpm install`. Replace each remaining snapshot with
an exact registry version once that release is published.

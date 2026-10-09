# Vendored packages

These tarballs keep coordinated prerelease packages installable without sibling
repositories or an unpublished registry release. The revision-stamped mdbase
and Connect SDK artifacts have adjacent JSON provenance manifests containing
their source commit, byte size, and SHA-512 digest.

Current snapshots were packed from sibling checkouts after their full test
suites passed:

- `../mdbase-contracts` (`tasknotes.task` pack `0.3.0-rc.18`, catalog digest
  `sha256:9a9ebc26…`, see `vendor/mdbase-contracts`)
- `../tasknotes-model` (`0.3.0-rc.15`, whose `@tasknotes/model/starter` defines the published starter type)
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

## Native app storage

`native-app-storage.json` pins the source, archive integrity and SQLite WASM
bytes. The storage archive contains only the six compiled JavaScript/declaration
files needed by `@mdbase-dev/obsidian-runtime/app-storage`, unchanged from its
source build, plus package metadata and the license. Only that subpath is
exported; vault, editor and other runtime modules are excluded.

Use exact sqlite-wasm `3.53.4-build2` in the same owned Worker as the native host,
with OPFS sahpool only. Dependency intake does not establish native READ, Saved,
or physical durability. No memory, automatic reset or alternate Worker fallback
is permitted.

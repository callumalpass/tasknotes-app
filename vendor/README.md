# Vendored packages

These tarballs keep coordinated prerelease packages installable without sibling
repositories or an unpublished registry release. The revision-stamped mdbase
and Connect SDK artifacts have adjacent JSON provenance manifests containing
their source commit and artifact hashes; the pnpm lock records SHA-512 integrity.

## Dormant next-SDK development snapshot

`mdbase-dev-sdk-0.0.0-d81ff861.tgz` pins the unpublished next SDK by source
revision and artifact integrity; the adjacent JSON records both hashes. This
snapshot is **development-only, not release-qualified**. Its TaskNotes record
projection tests use the SDK's protocol stand-in, not a real collection. The
application does not import or activate the next path yet. Replace the snapshot
with the SDK owner's qualified release pin before creating store candidates.
Do not interpret `0.0.0` as a released v2 package version.

## Development account getter

`mdbase-dev-connect-0.1.0-beta.129-3f2b9cd9.tgz` and its matching protocol archive
pin SDK-owned `accountBackend` from source `3f2b9cd9`. Their shared JSON provenance
records original filenames and SHA-256 hashes. Both dependency overrides use
these files, keeping one Connect/protocol graph rather than mixing proof APIs.
Package metadata remains beta.129; this is **not a registry release or qualified
store dependency**. The app's getter opening seam remains dormant. It supplies
no next Noise bridge, timers factory or transport qualification. Replace these
pins with qualified release artifacts before store candidates.

## Existing package snapshots

Current TaskNotes snapshots were packed from sibling checkouts after their full test
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

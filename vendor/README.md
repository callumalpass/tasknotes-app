# Vendored packages

These tarballs keep coordinated prerelease packages installable without sibling
repositories or an unpublished registry release. The revision-stamped mdbase
and Connect SDK artifacts have adjacent JSON provenance manifests containing
their source commit and artifact hashes; the pnpm lock records SHA-512 integrity.

## Combined dormant getter/timers/watch development snapshots

Connect and protocol `0.1.0-beta.129-f578ed55` plus native SDK `0.0.0-1f00edca`
are isolated, revision-stamped development archives. The shared
`mdbase-dev-control-watch-f578ed55-1f00edca.json` records component revisions,
original filenames and SHA-256 hashes; the lock records SHA-512 integrity.
Dependencies and overrides pin all three archives to one graph. This replaces
305ad941 with the delivered corrected timer factory source 7c2f20ea, then SDK
5ff45292 with the delivered watch-only 1f00edca composition. Connect/protocol
bytes are unchanged in the latter delivery. Watch readiness proves a current
subscription acknowledgement, including an empty one, not whole-cache catchup
or authority freshness. Source review is not runtime qualification. Original
timer-operation recovery remains unavailable in these SDK pins; timers stay
unwired. Query metadata/live metadata and trusted-profile bootstrap changes
316/337/346 are explicitly excluded.

This composition provides SDK-owned `accountBackend`, optional Connect
`appTimers(connection)` and native SDK `newTimersApi`. Credentials, keys and
proofs stay inside Connect. The native repository and account opener remain
**dormant and not release-qualified**. Protocol stand-ins do not prove real
collection, consent, transport or timer delivery qualification. These pins do
not include the ordinary next consent/route bridge or native query metadata.
Replace them with qualified release artifacts before store candidates.
Package metadata remains beta.129 and 0.0.0; neither is a registry publication.

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

# Vendored packages

These tarballs keep coordinated prerelease packages installable without sibling
repositories or an unpublished registry release. The revision-stamped mdbase
and Connect SDK artifacts have adjacent JSON provenance manifests containing
their source commit, byte size, and SHA-512 digest.

Current snapshots were packed from sibling checkouts after their full test
suites passed:

- `../mdbase-contracts` (`tasknotes.task` pack `0.3.0-rc.19` from
  mdbase-contracts PR #18, not yet published at mdbase.dev, so
  `pnpm contracts:sync` fails until it is; see `vendor/mdbase-contracts`)
- `../tasknotes-model` (`0.3.0-rc.20` from tasknotes-model PR #25, unpublished;
  replace with the registry version once it is published)
- `../tasknotes-nlp-core` (`0.3.0` at `abe88d9`, span-based parsing with input offsets)
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

## Connect consumer inputs

The application and its tests use only `@mdbase-dev/sdk`; there is no legacy
`@mdbase-dev/connect` client, query patch, sync override or connection fallback.
The SDK original remains `sdk-eaa4e697-production-beta141.tgz`, and
`@mdbase-dev/obsidian-runtime/app-storage` retains its original below. The
unchanged protocol original is still needed by the manifest builder/validator
and native publisher intake; it is also bundled inside the SDK.

Shared UI and i18n are exact npm `0.1.0-beta.148` pins, with registry integrity
checked in the lockfile. Dev/testing Connect packages are unnecessary:
application tests and benchmarks use the SDK's own testing entry.

The existing SDK setup journals still recognize their original task-pack
scope, and delayed-deletion journals retain their original
`authorityRequestId`. Neither journal needs the deleted legacy client;
new uncertain writes carry the SDK's `mutationId`.

## Interim browser pack helpers

`mdbase-browser-0.5.0-rc.1-c2c08afc9.tgz` is the unchanged browser package built
from exact mdbase-next main commit
`c2c08afc91f992a08b10c2ea33d30c7f7aa01f6b`, including guarded pack operations
and atomic schema-resource planning. No source patches were applied.

Archive SHA-256:
`6df89b5197ce2c49c83244d9aa97d37106171645f869cbcee1750a54a6521931`.
`mdbase-browser.pin.json` also records its byte size, lockfile SHA-512 integrity
and embedded WASM SHA-256/size. The initializer reuses the bounded same-origin
asset loader and explicitly supplies verified bytes to the package's `init`.
No helper call may rely on the package's implicit asset fetch.

This is an interim LAB/launch-preparation dependency. Replacing the file
snapshot with a published package version is a prerequisite before public
launch; release owns publishing. These pure helpers do not replace the native
held client/runtime or qualify authorization, receipts, READ or Saved.

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

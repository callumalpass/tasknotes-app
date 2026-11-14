# Vendored packages

Keep only the current dependency/deployment pins, their metadata and files read
by current checks. Old versions are recoverable from git; rollback uses the old
commit and its vendor inputs.

## Current inputs

- Production SDK: follow `production-trust.pin.json` to the SDK metadata and
  archive named by `package.json`. The automated repin writes these inputs.
  Staging publication selects the authenticated staging archive for this same
  production release; it does not use a historical vendored staging SDK.
- LAB SDK: `scripts/deploy-pages-dev.mjs` selects its isolated LAB archive.
- `package.json` and `pnpm-lock.yaml` identify the protocol, native app-storage,
  browser, NLP and spec archives still installed from this directory. Model,
  shared UI and i18n dependencies now use exact registry versions.
- `native-app-storage.json` and `mdbase-browser.pin.json` retain the current
  archive integrity and embedded WASM pins. Native app storage exposes only
  the app-storage subpath and uses the pinned SQLite WASM with OPFS sahpool.
- `mdbase-contracts/` holds the canonical contract packs, including superseded
  task contracts the manifest still provides. Refresh with `pnpm contracts:sync`.
  `obsidian-base-1.0.0.json` is also read by the native browser scenario.

Publisher intake authenticates the current production SDK and all current
`file:` dependencies before comparing **every installed file** with its frozen
original. “ALL installed originals” does not mean every historical archive in
this directory. Keep that comparison and the unique matching production-pin
check intact when repinning.

## Explicit test fixtures

These older inputs remain because current tests read them:

- `sdk-dev-cc492f3f.{json,tgz}`: original private-account LAB custody, native
  asset digests and absence of the earlier unused-protocol exception.
- `sdk-dev-4b955381.{json,tgz}`: the original unused-protocol warning regression.
  Its protocol bytes are read inside the SDK archive, not from another root tarball.
- `sdk-dev-eaa4e697-staging.tgz` and the two documents under
  `native-publish/staging-eaa4e697/artifact/`: custody and rejection of staging
  bytes as production. `ui-dev-fe158b59.json` records the historical peer pairing;
  its archive is not installed or read by these checks.
- `native-app-lab.json`, `mdbase-app-lab-trust.{mjs,d.mts}` and the pinned LAB
  WASM: immutable native context/runtime tests.
- `tasknotes-query-6bec1906*`: shared compiler intake and view-query regressions.
- `runtime-bases-witness-4370800f.wasm.gz`: the real Connect Rust non-app replay
  artifact from commit `4370800f0622e0a176118fc26115d2451fe202d5`. The native
  document regression verifies uncompressed SHA-256
  `cf38bb15f84966513cea170bbbddd23ce4f35028377ee897da54983d620a44da`
  (6,145,197 bytes) before testing Bases source admission. It does not qualify
  grants, storage, synchronization or LAB acceptance.

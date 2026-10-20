# Protected native Pages publisher — source only

TaskNotes native **NEVER merges to main**. Default `publisher=legacy`, main/tag
guards, GitHub Pages leg, LAB/Candidate B and SDK/UI/protocol pins are unchanged.
Native uses manual `workflow_dispatch`, literal `release/native-staging` or
`release/native-production`, target and exact lowercase 40-character source SHA.
Dispatch SHA, checked-out HEAD and authorized release head must agree, not merely
ancestry. Immediately before the single upload, `git ls-remote` rechecks the
**current** exact native head. Pages `--branch=main` is a production channel,
never a Git main checkout/merge.

## Authentication division (Co04:43:16 / 04:49:32)

NX-TRUST/TNAPP authenticate the full chain **ONCE OFF-CI** using private Ops
`verify-trust`. Public app CI binds exact originals to that authenticated owner
handoff. It does **not** perform/claim fresh signature, expiry, Sigstore,
image-attestation or publisher-CI authentication. No new public verifier
transport/API/helper upload/build or receipt-auth boolean is a gate.

Exactly four public, protected **per-environment** variables come from that
normal authenticated handoff, never candidate-generated defaults or labels:

- `NATIVE_SDK_SHA256`: unchanged original SDK tgz bytes.
- `NATIVE_UI_SHA256`: unchanged original UI tgz bytes.
- `NATIVE_PROTOCOL_SHA256`: unchanged original protocol tgz bytes.
- `NATIVE_TRUST_ASSET_SHA256`: RAW original SIGNED
  `next-trust/<environment>.json` bytes. Must equal authenticated inventory
  `trustAssets[0].sha256`, Ops `context.context.sha256`, SDK provenance
  `trust.sha256` and compiled `appReleaseTrust().assetSha256`.

The last digest is **not** trust module/context/receipt/native/archive SHA.
Module integrity is a separate original-member hash, not another environment
variable. Hash equality is byte binding, not a new authentication authority.

## Actual STAGING original intake; production absent

Canonical TNAPP public packet (nx-uiopen inbox line878 and controlling addenda)
retains ORIGINAL SDK/UI/protocol archive filenames, facts with SHA256/bytes/SRI,
source/tree, full `members.json` regular-member inventories, byte-identical
`provenance.json`, new SDK build receipt, exact `next-trust/` layout, original
image/trust inventories and signatures, and normal qualification/auth references.
No producer-private paths, verifier executable or alternative SDK schema aliases.

STAGING intake is now the accepted ONCE-produced original
`sdk-dev-a3023aee-staging.tgz`, 4460029B, SHA256
`c0bc377606df159d03c668923b7626f31459a1750ae0db033bb42789532c7296`;
SDK source a302/treec504, native725/6984/3676583, verifier0e44/4c72.
Independent public facts SHA256
`d313bb9dc2e291f957a77fa0c05fdff533a4cb79afa8973d63bca75c7897b44c`
is pinned BEFORE candidate execution. The exact owner packet is copied unchanged,
preserving producer-relative `artifact/`, `sdk-build-receipt.json` and
`verified-staging/next-trust/` layout, to `vendor/native-publish/staging/`.
No production config/material, original SDK rewrite, native/helper build or repack.

Reviewed APP input `config/native-publish/staging.json` pins exact lock, complete
packet file inventory, original SDK facts/member paths + facts digest, canonical
handoff/provenance paths, qualified native/verifier/source/run/attempt bindings,
and exact SDK/UI/protocol archive bytes/SRI/member inventories. It is NOT an SDK
schema or signing authority. SDK canonical `dependencies[].file` is SDK-relative
`vendor/<protocol-original>`, not a basename. Native `runtime.source.repository`
is `mdbase-dev/mdbase-next`, DISTINCT from trust release
`mdbase-dev/mdbase-connect`. Public facts/proofs/context/receipt remain verbatim.

UIfe and protocol129-c280 archives/pins/bytes are unchanged. UI uses its EXISTING
companion convention, not fabricated SDK public-facts aliases. The original UI
companion still says **noPublication:true**, paired SDK **cc492f3f**, NOT a302.
Those live publisher guards remain active and currently refuse publication.
Original byte custody and NEW consumer qualification are separate: the local-only
`qualify-native-staging.mjs` calls the data-only original validator before SDK
execution, then checks compiled staging trust and runs consumer tests/build.
It reports the UI publication constraints; it cannot waive them or supply fallback
hashes to the live workflow. No fake GitHub event/ref, dirty-guard bypass, credential
or app-publication claim. Normal owner review must resolve the UI publication
metadata/peer qualification before actual publisher CI.

Every original installed member is compared. pnpm10.7 generates ONE additional
`node_modules/.bin/yaml` in SDK and protocol packages. These are NOT original
members: a separate narrowly scoped installer-output policy compares every byte
against reviewed pnpm10.7 `generateShShim()`, binds the original YAML bin/manifest,
checks its exact target and ALL external registry YAML members against the SDK's
bundled original YAML, and records the generated shim separately in logs. Other
extras, injected wrapper commands, shadow node binaries, links and mutations refuse.
No blanket `.bin` exclusion, shim execution, SDK rewrite or install-policy weakening.

The guard checks exact originals, SHA512/SRI and frozen lock before install;
safely reads every original tar member (rejecting links, traversal, duplicates,
ambiguous/unsupported entries and resource excess); binds all member inventories,
UI/SDK pairing and bundled protocol originals. Install uses frozen lock and
`--ignore-scripts`. **Every installed SDK/UI/protocol member** is checked before
any candidate SDK code/tests/build executes. Packaged provenance, signed raw asset,
context, build receipt, proof hashes, image/inventory source/run/attempt and
qualified verifier/runtime/SQLite bindings are compared as data. Only then does
the unprivileged job call compiled `appReleaseTrust()` and build once.

## Privilege split and exact deploy-tool bootstrap

`native-build` has **no GitHub environment and no Cloudflare secrets**. It checks,
frozen-installs, tests, builds once with exact target origins, runs the strict
canonical manifest validator (no allow-local), then inventories EVERY final file
AFTER offline shell/static routes. Artifact includes hidden/underscore files,
`.well-known`, worker/SDK/native/SQLite bits and prepared source/tree/run receipt.
It is uploaded once using immutable Actions v4 ID and SHA256 ZIP digest outputs.

`native-publish` alone enters protected `staging`/`production`. It installs NO app
dependencies, workspace, project hooks or build; it executes NO artifact-provided
project scripts and imports NO SDK code. It checks out reviewed uploader source
at the exact source SHA. Only the upload/capture step receives the existing
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`; GitHub token is read-only
contents/actions metadata+artifact download, never environment approval/policy APIs.
Job-scoped `contents: read` + `actions: read` exist ONLY on protected publication;
unprivileged build retains `contents: read` only. Served verification is a separate
credential-free step, gated on `native_upload` success AND nonempty captured actual
`deployment_id`; its source guard also checks UUID/status/source/target/run.
Uploader success without successful actual UUID capture cannot start served checks.

**Co05:15:43 tooling choice:** official Wrangler **4.114.0** from dedicated minimal
`scripts/native-publish-tooling/package.json` + integrity-bearing `pnpm-lock.yaml`.
Copy ONLY those files into `$RUNNER_TEMP/tasknotes-publish-tooling`; install with
`pnpm install --frozen-lockfile --ignore-scripts --ignore-workspace`, in that CWD,
with `env -i`, isolated HOME/user/global npm configuration and explicit npm registry.
No app/workspace/npm config is inherited. No prebundled/preinstalled-tool gate.
Call the isolated absolute Wrangler JS entry directly with Node, empty independent
CWD, `--no-bundle` and `--force` (Pages only, no automatic Workers delegation),
no app config/functions/hooks. These flags/output fields were checked in the
locally cached official4.114.0 CLI source; no Cloudflare network was used. No app package manager executes
in the protected upload. This tooling setup is NOT SDK authentication.

Uploader validates immutable artifact ID/digest, GitHub repository IDs, run,
run attempt, dispatch event/native branch, source SHA and target; independently
hashes original downloaded ZIP before safe bounded extraction. Only receipt/dist
entries, no symlinks/traversal/duplicates/project scripts. Files and directories
become read-only. Receipt's source tree/target/full original inventory/run must
match reviewed checkout and independently checked four protected hashes.
Full final path-set/size/hash assertion catches missing/extra/tampered files;
no writers/build/install/hooks intervene between assertion, current native HEAD
recheck and ONE upload. Source-only tests do not prove live artifact APIs/tooling.

## Served bytes, hosting policy and retained failure evidence

Shared helper is copied **UNCHANGED** from Journal2007dc4:
`scripts/lib/native-publish-bytes.mjs`, SHA256
`a4336258cea726285573e9e667bba1c1ad6797fdba331715d0f17ea67ea5c66a`.
Its qualified 72 tests are included with import-path-only adaptation.

The actual deployment UUID from Wrangler4.114 structured JSONL is recorded
**before** served checks, then exposed through the upload/capture step output.
Failed/missing capture fails the upload step and leaves served verification skipped;
evidence retention remains `always()`. A minimal non-authenticating attempt receipt
is initialized BEFORE source/intake checks; missing/mismatched protected hashes
therefore retain a FAILED receipt with source/run/target and null deployment,
BEFORE artifact APIs/tool/upload. Upload failures also retain JSONL, inventory, immutable
artifact identity, source/tree/run evidence and failed receipt. No automatic
rebuild, re-upload, rollback, redeploy or retarget on a readback failure.

Bounded same-origin, credential-free GETs compare actual lengths/SHA256 of ALL
servable HTML, manifest/webmanifest, JS/trust, service worker/offline files,
WASM/native, SQLite and other assets against full final inventory. Source-reviewed
canonical mappings only; redirects, resource excess, timeout and ANY returned
failure block success. Shared helper ceiling: 3 attempts, 10s/request, 180s entire
byte pass. Independent trusted static header/route pass has its own 180s ceiling.
Custom 404 requires real404 and exact bytes, not an HTTP200 fallback/marker.

Controls remain in the FULL upload inventory. `_headers` and `_redirects` are
**unverified** until independent source-reviewed security/cache header checks
(on every successfully byte-verified asset) and exact known route/custom404
checks pass. Official Wrangler4.114 Pages static `validate()` IGNORE_LIST is
`_worker.js, _redirects, _headers, _routes.json, functions, **/.DS_Store,
**/node_modules, **/.git, .wrangler`: it does NOT ignore the existing root
`public/.nojekyll`. Vite copies that marker unchanged; it is an ordinary served
asset, requiring actual byte + header evidence at `/.nojekyll`, not a control
waiver. Unknown/nested controls (including nested .nojekyll), `_routes.json` and Pages
`_worker.js` remain unverified and block a complete receipt pending independently
reviewed policy coverage. A GET of `_worker.js` is NEVER executed-worker evidence.
Known static policy success is `bytes-and-static-hosting-verified`, not native
sign-in/grant/readiness/application admission.

## External policy and remaining gates (parent-owned)

- Verify/configure environments **before dispatch** (absent environments may be
  auto-created): protected `staging` and `production`, permitted legacy main +
  exact native target ref. Native branches require reviewed workflow/source,
  no force updates/no bypass. Source does not mutate or self-certify protections.
- Production: required **Callum reviewer**, **no admin bypass**, NOT a
  prevent-self-review requirement. Separate Callum GO BEFORE any production
  dispatch/tag/upload; human environment approval ONLY in GitHub UI. Agents never
  invoke pending-deployments approval APIs or plaintext approval hashes.
- Actual STAGING originals/reviewed frozen intake are present. Parent reports
  the four STAGING per-environment values configured/audited; this source task
  did not query/configure them. Production config/hashes/GO remain absent.
  Parent retains actual **per-environment** values/protection audit:
  GitHub `vars` repository/organization fallback can otherwise hide an absent
  environment value. String format/equality cannot certify variable scope or
  protection. Verify credentials/account/project privately, without printing values. This work performs no credential/policy/resource/ref/network publication.
- Staging is EXACT `https://staging.tasknotes-app.pages.dev`, paired Editor
  `https://editor-staging.mdbase.dev`, CP `https://connect-staging.mdbase.dev`;
  no inherited loopback or LAB fallback. Production is `https://app.tasknotes.dev`,
  Editor `https://editor.mdbase.dev` (linked existing native release plan), CP
  `https://connect.mdbase.dev`. Pages project `tasknotes-app`.
- Default workflow registration, live immutable-artifact/tool/bootstrap/hosting
  evidence, real paired Editor+TaskNotes staging admission and later production
  GO remain parent-owned. Never merge TaskNotes native to main for registration.

Actual unprivileged staging qualification: `rpnpm run test:staging-intake`,
`rpnpm run test:staging-consumer` (full Vitest), and ONE causal app build
`rpnpm --pull dist --pull test-results/native-staging-qualification.json run build:staging:qualification`.
Each verifies all installed originals and the independent approved tuple BEFORE
candidate SDK/Vitest/Vite execution. Exact app/Editor/CP staging origins, no loopback.
These are not GitHub dispatches/authentication, publisher CI or admission.

Source checks: `rpnpm run test:native-publisher`, `rpnpm run test:release`,
`rpnpm run typecheck`, `rpnpm run lint`, `rpnpm run format:check`, actionlint.
Ordinary source checks/builds are NOT target-native admission or served proof.
Legacy GitHub Pages retention/retirement at cutover remains Callum's decision.

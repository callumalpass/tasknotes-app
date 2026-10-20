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

## Real target intake — currently absent, intentionally refuses

Canonical TNAPP public packet (nx-uiopen inbox line878 and controlling addenda)
retains ORIGINAL SDK/UI/protocol archive filenames, facts with SHA256/bytes/SRI,
source/tree, full `members.json` regular-member inventories, byte-identical
`provenance.json`, new SDK build receipt, exact `next-trust/` layout, original
image/trust inventories and signatures, and normal qualification/auth references.
No producer-private paths, verifier executable or alternative SDK schema aliases.

After real owner custody arrives, review a target-specific APP input descriptor
`config/native-publish/<target>.json` alongside original archives in `vendor/`
and packet under `vendor/native-publish/<target>/`. This descriptor is reviewed
app policy, **not** a public SDK contract or candidate authority. It pins:

- `environment`, `logOrigin`, raw `assetSha256`, exact `lockSha256`;
- `packetFiles`: full packet path/bytes/SHA256 inventory, binding facts and proofs;
- `archives.sdk/ui/protocol`: original `archive` basename, `bytes`, `sha256`,
  `sri`, SDK/package `source`, `sourceTree`, packet-relative `facts`/`members` paths;
- canonical `verifier`, `runtime`, `sqlite`, `image_publication`,
  `trust_publication`, `publisher_qualification` expectations from the handoff.

Do not create such a descriptor from self-described candidate metadata or fill
missing target values from LAB. Review pins/authentication evidence through the
normal owner channel. No descriptor or actual staging/production originals are
invented here. Current LAB SDK and no-publication UI do not authorize either target.
No SDK/native build, repack, retarget, repin or lock substitution is performed.

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
evidence retention remains `always()`. Upload failures also retain JSONL, inventory, immutable
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
checks pass. Unknown/nested controls, `_routes.json`, `.nojekyll` and Pages
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
- Real target originals/reviewed frozen intake and the four protected vars are
  still missing. Parent must audit actual **per-environment** values/protections:
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

Source checks: `rpnpm run test:native-publisher`, `rpnpm run test:release`,
`rpnpm run typecheck`, `rpnpm run lint`, `rpnpm run format:check`, actionlint.
Ordinary source checks/builds are NOT target-native admission or served proof.
Legacy GitHub Pages retention/retirement at cutover remains Callum's decision.

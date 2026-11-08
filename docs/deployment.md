# Web App CD

Ops `mdbase-dev/mdbase-cloud-ops` owns selection through `bin/release app-cd`,
`config/app-cd.json` and one reusable `app-publish.yml`. It selects exact-source
green main push CI (`ci.yml`), publishes/smokes staging, then publishes/smokes
production. One failed app stops only its own line and wakes the existing release
supervisor webhook. No Server CD or store logic is added.

`deploy-tasknotes.yml` accepts a full `source_sha` on main, never a native branch
or mutable tag. Workflow-owned helpers authenticate npm/Sigstore production SDK,
the same-producer signed staging archive, frozen file/UI originals, all installed
original members, protected raw target trust and immutable same-run artifact
custody before protected upload. The unprivileged build dynamically imports
candidate-local build code **after** the ALL-original gate; the dependency-free
publisher never executes candidate code. Both upload boundaries re-read actual
production server/provider producer ancestry. Incompatible/unknown revisions wait
without uploading.

The served entry `assets/index-tasknotes-<12-hex-source>.js` identifies the build.
The dashboard reads that entry, never main's desired SDK pin. Old content hash
`app-BS9YgI2X.js` is explicitly unknown source, not an inferred commit.

## #1223: qualified, permanent SDK floor remains

The actual SDK pin names beta.158, producer
`373c4a4e78e821e45a330e156a019a7aa635cfe8`, containing Connect
`c42d004e3e4985df2cf54829c693f0e864972d2e`. TaskNotes #338 is merged.
The publisher independently checks beta.158+ and authenticated producer ancestry;
ops enforces the same permanent producer floor.

Production was initially disabled in both repositories. The distinct GCP staging
qualification at app `15d919011a5ae743618517d03a60acf4ed7fa91e` and server
`4af641695de2e6de0d5674f715dd1eccb8d03aa6` passed: released beta.7-upgraded custom
type in **Cloud copy**, preserved mappings and task bytes through Setup,
mapped completion/reopen and reload with native daemon off, and actual pinned
runtime/SQLite wasm routes. The previewed automatic type update 4→5 preserved
every mapping; no replacement was accepted. Full cleanup is retained in
[ops #1576](https://github.com/mdbase-dev/mdbase-cloud-ops/pull/1576) and
`docs/deployment-reports/2026-11-07-tasknotes-web-enrollment-and-staging-hold.md`
there. Signed-out smoke was not used as that evidence.

App production admission is enabled only after this qualification; the central
ops production flag must also be enabled through its normal reviewed PR. No UI,
SDK, wasm, trust or mobile behavior changes with this publisher-only enablement.
There is no dispatch override. Exact-source CI, fresh staging/smoke, production
compatibility, production smoke and predecessor recovery remain mandatory.

## Targets, settings and identity

- Existing Pages project `tasknotes-app`, UUID
  `8f377e88-f1d0-4a5a-8928-2daa3e7c527a`, production channel `main`.
- Staging `https://staging.tasknotes.dev`; production
  `https://app.tasknotes.dev`. Keep Cloudflare Git deployments disabled.
- Existing protected `staging` and `production` environments admit only main,
  with no tags, reviewers or wait timer for web App CD.
- Existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` credentials remain.
  `TASKNOTES_TRUST_ASSET_SHA256` must be set at each target environment:
  production `7912e40838213e60b65848350d319a48019021317b112e3326429b250f0133d7`;
  staging `18ae86a26f9c8b2442235c537b8d58dcc059c05e4bb0f175607fd0aeacc3f0ad`.
  Raw assets in `config/next-trust/` are byte-verbatim, never formatter-owned.
  Old staging differs only in issuance/source attribution; roots, policy keys
  and origins are unchanged. Remove retired `NATIVE_*_SHA256` variables and
  native environment ref admission after the replacement merges.
- The existing release App is installed on this personal-account repository.
  Ops mints repository-scoped Actions-write/Contents-read credentials from the
  configured owner and a separate ops/Connect evidence reader. No token fallback.
- Web builds set the exact target app/Editor origins, web-only manifest and no
  Firebase native delivery. Mobile manifests, signing, store lines and #348
  are untouched. LAB remains on its independent development helper.
- `ci.yml` retains the legacy GitHub Pages redirect only; it never uploads a
  Cloudflare web build. The retired manual/native/weekly web paths are not
  alternatives. The central SDK repinner remains the only SDK writer.

## Verification and automatic recovery

Full inventories include hidden/control files, custom callback/route rewrites,
404, security/cache/MIME policy, PWA/service worker and original SDK native/SQLite
bytes. Fresh cache/SW-free browser smoke verifies source, Sign in, no page errors
and no readiness fence. Both immutable deployment and canonical alias are read.

Before production upload, retain the full canonical UUID and transitive static
asset fingerprints. Incomplete upload, failed verification, smoke failure or
cancellation invoke normal predecessor Pages recovery. Recovery refuses a newer
publisher and verifies saved alias bytes over a stable interval. A restore is
still a failed app attempt, never a green release. Do not rerun CD to qualify it.

After production is enabled and shipped, a direct human same-source
`drill: true` run captures the predecessor, publishes a distinct UUID, completes
normal smoke, intentionally fails, and proves normal recovery. It is not a
cross-source, signed-in or mobile drill. Preserve bounded attempt artifacts and
normally merge a privacy-bounded ops deployment report after every deployment.

Local source checks: `rpnpm run test:publisher`, `rpnpm run verify`, and
`rpnpm run rehearse:publisher production|staging`. Rehearsals reproduce separate
candidate and dependency-free publisher checkouts, authenticate actual originals
and verify complete final inventories without publishing. No deployment secrets
are permitted. `production-smoke.yml` keeps the existing scheduled public
boundary checks; it neither publishes nor authorizes #1223 qualification.

## Authenticated SDK intake

When `GITHUB_TOKEN` is present, SDK release metadata and staging archive/bundle
bytes use GitHub REST. Asset bytes use
`/repos/mdbase-dev/mdbase-connect/releases/assets/<id>` with
`Accept: application/octet-stream` and Bearer authentication. Without a token,
assets use their exact `browser_download_url`; authenticated failures never fall
back anonymously. Exact asset names and browser URLs, SHA256 digests, and the
repository/workflow/ref/source attestation identity remain mandatory. npm and
unrelated archive hosts never receive the token; tokens and asset IDs are not
persisted in plans.

Staging installation uses the same transport. Installed-original comparison
re-downloads use the same transport and retain the plan digest and every-member
checks. The workflow supplies the read-only job token only to intake,
installation and comparison, alongside existing workflow-owned API checks. The
build wrapper deletes it after the original gate and before dynamic candidate
imports or dependency/application hooks. Dependency installation itself does not
receive it. All jobs inherit `actions: read` and `contents: read`, with no write
overrides.

Transient reads retain retryable 403/408/429/5xx responses and network failures,
with waits of 5, 20, 60 and 120 seconds and a 30-second per-attempt timeout. One
read permits five attempts over 355 seconds; the protected guard step allows
seven minutes. Existing job deadlines and upload/recovery constraints are
unchanged.

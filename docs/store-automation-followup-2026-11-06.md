# Store automation follow-up — 2026-11-06

## Outcome and authority

Partial completion, **not ready for the first real submission**. Production
submission remains disabled. The release supervisor owns the first GO; this is
not an owner escalation. No signing identity, trust key, SDK pin, environment
permissions or ops files changed. No real production store submission occurred.

Implementation: [#343](https://github.com/callumalpass/tasknotes-app/pull/343).
Bounded failure diagnostics: [#344](https://github.com/callumalpass/tasknotes-app/pull/344).

## Exact remaining build blocker

The signed-native wasm proof producer is **still unimplemented**. No new signed
build was dispatched, and no new qualified build or passing proof is claimed.
This is unfinished native-harness implementation work, not a human approval
that can substitute for evidence.

The current app harness cannot supply the required evidence:

- `e2e/cloud-connection.spec.ts` and `src/test/next-entry-smoke-fixture.tsx`
  explicitly use SDK protocol stand-ins; their e2e-only route is pruned from
  normal production builds.
- `scripts/android-smoke.mjs` drives the notification-only diagnostic app,
  installs a debug APK and attaches its WebView debugger. It does not exercise
  the release application's native wasm, SQLite reopen, or task CRUD.
- The release workflows sign/package APK/AAB and IPA, but contain no qualified
  native device/emulator task journey or exact-signed-artifact wasm runner.

Required implementation: a registered-test-account native lane must install and
launch the exact retained signed artifact, run real runtime initialization,
SQLite query/write/reopen and TaskNotes task create/edit/reload through the app's
own harness, clean its owned resources, and produce the artifact-digest-bound
`qualification.json` **inside that same source build run**. A web/dev rebuild,
stand-in, manual success JSON or borrowed historical proof must not pass.
The existing consumer guard still refuses missing/failed evidence.

## Observed store and API state

Protected-main read-only [Store status run 42302410825](https://github.com/callumalpass/tasknotes-app/actions/runs/42302410825)
succeeded on merge `a79a11735b69a9e923dd69e7d69305f6fc6b4493`:

- App Store live: **1.0.12**.
- Play production: **1.0.12**, version code **100738**, completed.
- Play release-lifecycle observer: **unavailable**, therefore queue fails closed.
- Android Vitals: **HTTP 403**, unavailable; only Connect/CP/provider readiness
  remains observable. This is not a passing Vitals or on-device smoke result.

The current public Android Publisher discovery document exposes
`applications.tracks.releases.list`, whose release lifecycle includes in-review,
not-approved and published. The implementation reads every track and cross-checks
production version codes. Track status alone never substitutes for review state.
Every edit commit now uses `changesInReviewBehavior=ERROR_IF_IN_REVIEW`, not the
review-cancelling default. The bounded diagnostics artifact names the failing
step and a fixed error category; it never includes Google response bodies.

Vitals requires **Google Play Developer Reporting API** on the existing Play
service-account credential's project, OAuth scope
`https://www.googleapis.com/auth/playdeveloperreporting`, and the account's
**View app information (read-only)** permission for TaskNotes. No credential
or cloud-project permission changes were attempted. Follow the exact successful
status run's `play-vitals-capability/play-vitals.json` for its bounded denial
category. Missing access does not permit widening on infrastructure health alone.

Private residual Console step: **Play Console → TaskNotes → Publishing overview /
Policy status → rejection details**. The release-summary API does not return
rejection explanations or every metadata-only pending change. Routine rejection
repair remains agent work; legal/account attestations need the appropriate human.

## Cooldown evidence

The 21:11:47Z dry run
[42294707028](https://github.com/callumalpass/tasknotes-app/actions/runs/42294707028)
was inspected privately. Its exact successful step had `SUBMIT=false` and
`RELEASE=false`. The prior queue counted all workflow attempts: **the queue, not
an observed Apple store limit**, caused the 24-hour block.

The legacy no-write observation is narrowly SHA/run/attempt/time bound in
`config/mobile-read-only-reconciliations.json`, with a step-log SHA256 but no
payload. A direct current-API cooldown evaluation verified that this run is
read-only and that the App Store cooldown passes. New read-only dispatches retain
an exact-run receipt before preflight; missing/unknown write evidence still
blocks. In-flight and rerun attempts never borrow a prior receipt.

## Proposed release plan — blocked, not GO-ready

- **Version:** prepare **1.0.13** through an ordinary main PR because 1.0.12 is
  already live. No version bump or release tag was created in this follow-up.
- **Build:** not yet allocated. Historical Android run **41615558432** (738,
  code 100738) and iOS run **41615565002** (build 30) are 1.0.12 at
  `1fedfbfbc4bd7a653318f95560cc16450edbe310`, not new qualifying candidates.
- **SDK:** retain `@mdbase-dev/sdk@0.1.0-beta.158`, producer
  `373c4a4e78e821e45a330e156a019a7aa635cfe8`, committed archive SHA256
  `3742d3770953f2da5381d94265b0bb7c85103ad8690f7ddaa7d2c8b583538e24`.
  Existing production trust remains unchanged.
- **Wasm evidence:** absent. Implement the native producer first, then build
  through normal green main CI and alpha/TestFlight paths; retain exact run,
  artifact ID/digest and exercised proof before requesting GO.
- **Play:** fresh lifecycle observation, no earlier review, valid source/CI/SDK/
  wasm, completed alpha and cooldown; supervisor GO before enabling/submitting.
  Start 10%, then 50% after 24 continuous monitored hours, then 100% after another
  24 hours. Each widening requires sufficient fresh exact-version Vitals. Keep
  monitoring through seven days after promotion.
- **Apple:** exact signed/processed/TestFlight-eligible build, fresh review state,
  complete metadata and the same source/wasm/cooldown guards; supervisor GO before
  enabling/submitting. Apple review and its existing MANUAL release boundary
  remain distinct steps.
- **Halt:** boundary/Vitals failure halts only the exact owned staged Play
  version and opens only its Play hold, even if halt outcome is unknown. Missing
  Vitals holds the fraction, then halts after 72 continuous monitored hours at
  that stage. A halted version never resumes automatically. Unknown ownership
  causes a line stop without a speculative track write. At completed/100%, a
  failure stops future publication; the staged-halt API cannot undo a completed
  release, so recovery needs a new qualified recovery plan, not an automatic
  downgrade. App Store rejection stops only iOS; it is not a server rollback.

## Validation

- Full exact-head PR #343 CI: Android build, iOS build and production smoke
  passed; signed release job correctly skipped on the PR. Squash merge used the
  exact SHA returned by GitHub.
- Remote release Node suite passed (422 tests, one existing skipped before the
  additional receipt/rollout tests); focused new tests passed.
- All 19 Play Vitest publisher tests, remote lint and typecheck passed.
- `actionlint` and `git diff --check` passed.

No result above qualifies a signed-native wasm route. The first production plan
must return with an actual new build identity and passing native proof before
any GO is requested.

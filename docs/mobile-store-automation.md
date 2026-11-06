# Independent mobile store submission

## Current rollout hold

**Automation is disabled by default. Do not enable or submit until Callum has
seen the exact candidate plan and said go, and the wasm route has been exercised
on that exact signed build.** This implementation does not change either enable
variable, signing identity, trust key, environment policy or store submission.

The SDK floor is Connect `c42d004e3`. The source package must name its committed
production archive, match its SHA256 and pin, and the authenticated repository
comparison must establish that the pin's producer contains that commit.
Current beta.158's pin names producer
`373c4a4e78e821e45a330e156a019a7aa635cfe8`, which contains it. This is not
evidence that an older TestFlight or Play build contains that SDK.

## Front doors and policy

- `mobile-store-queue.yml` evaluates each platform independently every hour.
  Both are plan-only unless their repository/environment variable is exactly
  `true`: `TASKNOTES_PLAY_AUTOMATION_ENABLED` and
  `TASKNOTES_APP_STORE_AUTOMATION_ENABLED`. These are not set by this change.
- Shared policy is `scripts/mobile-release-policy.mjs`. Selection walks main
  commit order, not workflow completion order. Latest exact main-push Android
  and iOS CI must be green; a failed newer attempt cannot borrow old green.
- The selected signed Android tag run must match its completed alpha version
  code. iOS must have exactly one signed artifact and a confirmed TestFlight
  upload. The normal Apple submission script independently checks the exact
  processed, App-Store-eligible build, metadata and all active reviews.
- A 24-hour gap counts every earlier production-workflow attempt, including
  dry/preflight failures, conservatively. In-flight attempts block. Rerunning a
  production workflow is refused; unknown writes require reconciliation.
- Both existing production publishers repeat the common guards immediately
  before a mutation. `ios-release.yml` only builds/uploads TestFlight now;
  its parallel public-submission path is removed. Direct recovery submission
  remains through `app-store-submit.yml`, with the same gates.
- Queue decisions are uploaded **before** dispatch. The queue follows only the
  dispatch-returned run ID, first attempt, main, expected event and workflow.
  Unknown/failed dispatches stop that store rather than being retried.
- App Store metadata uses explicit version notes when present. Otherwise it
  derives locale-complete neutral version notes and reviewed sign-in
  instructions from the repository's latest reviewed metadata. Store contacts,
  screenshots and existing review credentials are inherited/verified; no agent
  invents legal declarations or credentials. Google Play gets neutral release
  notes on alpha and carries them into production.

## Exact-build wasm evidence (not implemented by the native harness yet)

Source build runs must retain an artifact named
`tasknotes-mobile-wasm-android` or `tasknotes-mobile-wasm-ios`, containing
`qualification.json`. It is read only from that same trusted, successful
source build run, never from a mutable branch or an arbitrary supplied file.

```json
{
  "schema": "tasknotes/mobile-wasm-qualification/1",
  "platform": "ios",
  "sourceSha": "FULL_MAIN_SOURCE_SHA",
  "sourceRunId": 123,
  "buildArtifactId": 456,
  "buildArtifactDigest": "sha256:DIGEST_FROM_GITHUB_ARTIFACT",
  "wasmRoute": "passed",
  "checks": {
    "runtime-initialized": true,
    "sqlite-open-query-write-reopen": true,
    "task-create-edit-reload": true
  }
}
```

This is an **evidence contract, not a manual override**. Do not hand-write
passing flags or attach a web/dev build's evidence to a signed native binary.
The native test harness still needs to download/launch the signed IPA/APK
corresponding to that exact source-run artifact, exercise those checks using a
registered test account, and emit the digest-bound proof in the source run.
Until that producer exists, the guard refuses publication. Current older
production/TestFlight builds do not qualify by association with newer main.

## Play rollout and its API limit

Production promotion now requests `inProgress` at **10%**, preserving the
previous completed release. There is no full-rollout fallback if Play refuses
staging. `setProductionRollout` supports exact-version halt/completion, preserving
other completed versions; only halt is scheduled.

`mobile-post-release.yml` checks every 15 minutes under the same production
concurrency lock as promotion and Play status reads. It checks Connect health,
CP readiness and provider readiness. A failed check halts only the exact owned
staged version, then opens only the Play app stop. Unknown ownership or halt
outcome stops the line without guessing a track mutation. Healthy checks do
**not** silently complete the rollout. These infrastructure checks are not
Android Vitals or an on-device post-release smoke.

Android Publisher `edits.tracks.list` **does not expose** Publishing Overview
review state, pending changes or rejection reasons. Existing production release
state confirms historical production access; `completed` alone does not prove
there is no earlier change in review or universal live availability.
Therefore Play submission always additionally refuses with
`play-console-publishing-overview-review-observer-required`, even if enabled.

Exact remaining integration: an authenticated agent/Console observer must read
**Play Console → this app → Publishing overview**, establish no earlier change
in review/pending publication, and read any rejection reason privately. Its
fresh source-bound observation needs a mechanically checked custody contract
before the refusal can be replaced. No loose boolean/repository variable
substitutes for it. Play rejection detection/reason retrieval, Android Vitals,
and safe completion of the staged rollout are not implemented by this API-only
integration. No owner escalation is required for routine rejection: an agent
reads the reason, fixes/rebuilds or resubmits through green CI, reconciles and
clears only the affected line. Signing/trust changes still return to Callum.

## Isolated stops

Ops `tasknotes-store-line.yml` reads/stops these hold-only lines:

- `tasknotes-google-play`
- `tasknotes-app-store`

Each uses `app-stop` plus its own exact
`<!-- mdbase-app-line:LINE -->` marker. They are not enrolled in
`config/app-cd.json`; Server CD, Desktop and other apps do not read them.
The personal-account release App token dispatches TaskNotes. A separately
minted organization installation token reads Connect ancestry and dispatches
the ops line workflow; ops `GITHUB_TOKEN` owns Issues access. The App receives
no new Issues grant. Follow exact dispatch IDs and retained bounded artifacts.

Apple rejection states stop only iOS. The API does not provide the full
Resolution Center conversation used to explain every rejection; the agent may
need **App Store Connect → App Review → rejection message** to read it privately.
The queue does not cancel an earlier review, change signing or automatically
rewrite a rejected build. After repair and reconciliation, an operator uses
`bin/release app-line clear tasknotes-app-store|tasknotes-google-play` in ops.
Never apply a server stop or server rollback to a store issue.

## Dashboard data

`store-status.yml` runs hourly and on demand. Download its exact successful
main/first-attempt run artifacts via GitHub Actions API:

- `store-status-android/store-status-android.json`
- `store-status-ios/store-status-ios.json`

Both use schema `tasknotes/store-status/1`, `observedAt`, `platform`, `live`.
iOS live is read from `READY_FOR_SALE|READY_FOR_DISTRIBUTION`, not package.json.
Android live is a committed production-track snapshot with status, version code,
name and fraction, **not proof of review approval or every country's availability**.
Consumers must reject stale (>2h), missing or failed observations. The queue
consumes the concurrency-protected Android artifact rather than opening an edit
while a publisher may own one. The dashboard still needs to wire this artifact
reader; no dashboard deployment is made here.

## First legal production attempt

1. Merge green exact heads normally; confirm both App installation scopes and
   environment secret names through read-only workflow runs.
2. Prepare a new numeric store version through normal main PR/CI if the current
   package version is already live. Build/upload only to alpha/TestFlight.
3. Exercise wasm on the **exact signed artifact** and retain the bound proof.
   Implement the missing proof producer; do not synthesize a passing artifact.
4. Read a fresh store plan. For Play, implement the Console observer first.
5. Tell Callum the exact platform, source SHA, SDK producer, artifact digest,
   store version/build, review state, notes and proposed 10% rollout/Apple release
   policy. Wait for go before enabling either line or submitting.
6. With authorization, enable only the chosen store, evaluate a fresh plan and
   dispatch through the existing publisher. Observe review, rollout and checks.
   Retain the bounded attempt and complete the normal deployment report.

Unattended end-to-end production is **not ready** until the named proof producer
and Play Console observer are implemented and exercised. Apple review and store
policy/legal account attestations remain store-owned; no workflow can grant
approval or invent a legal response. No production submission was made by this
implementation.

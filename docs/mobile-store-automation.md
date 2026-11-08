# Independent mobile store submission

## Current rollout hold

**Automation is disabled by default. Before Callum says go as release supervisor,
Callum or an agent must manually check the exact TestFlight or internal/alpha-track
build and show him the exact candidate plan. Promote that same binary to
production.** This implementation does not change either enable variable,
signing identity, trust key, environment policy or store submission.

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
- A 24-hour gap counts production-workflow attempts with possible writes.
  **Read-only dry runs do not consume it**, including failed read-only checks
  with a retained, exact-run read-only receipt. In-flight attempts still block.
  Missing/expired/unbound receipts and unknown writes remain conservative blocks.
  Rerunning a production workflow is refused; unknown writes require reconciliation.
  The successful 2026-11-06 **21:11:47Z** App Store dry run
  [42294707028](https://github.com/callumalpass/tasknotes-app/actions/runs/42294707028)
  was verified privately: `SUBMIT=false`, `RELEASE=false`. The old queue's
  workflow-counting rule, **not an observed Apple limit**, consumed the cooldown.
  `config/mobile-read-only-reconciliations.json` binds this legacy no-write
  observation to its exact SHA, attempt, timestamp and step-log digest; it
  contains no log payload. Future dry dispatches retain
  `mobile-read-only-attempt/read-only-attempt.json` before source checks.
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

## Play review observer and rollout

The current Android Publisher API **does expose release review lifecycle** through
[`applications.tracks.releases.list`](https://developers.google.com/android-publisher/api-ref/rest/v3/applications.tracks.releases/list),
outside a disposable edit. `store-status.mjs` reads every discovered track,
including custom closed tracks. It distinguishes draft, not sent, in review,
approved/unpublished, rejected (`NOT_APPROVED`) and published releases.
The release summaries must corroborate the production version codes.
Unknown/unavailable/malformed/capped observations fail closed; rejection stops
only Play. A completed edit track is never substituted for review approval.

Both initial publication and rollout mutations also use
[`changesInReviewBehavior=ERROR_IF_IN_REVIEW`](https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit).
This is a store-side final race guard, not a retry: unlike the API default,
it must not cancel an earlier review. There is no fallback without that guard.
Release summaries do **not** provide rejection text or all app-level policy/
metadata-only pending changes. The exact residual private step is **Play Console
→ this app → Publishing overview / Policy status → rejection details**.
A review-guard rejection/unknown write stops this line for reconciliation; no
owner escalation is needed for routine repair. Legal attestations remain human
decisions. No Console automation or unsupported scraping is introduced.

Production starts at **10%**. `mobile-post-release.yml` observes every 15 minutes
under the production concurrency lock. It checks Connect health, CP readiness,
provider readiness, release lifecycle, and exact-version Android Vitals.
Widening additionally requires the enable variable and an unstopped Play line:

1. 10% → 50% after at least **24 continuous monitored hours** at 10%.
2. 50% → completed/100% after a further **24 continuous monitored hours** at 50%.
3. Continue post-completion checks through seven days after initial promotion.

Each step needs the latest **six complete hourly Vitals buckets**, all after
the stage began, for the exact version. Each bucket needs at least 100 reported
distinct users, and zero user-perceived crashes/ANRs (conservative initial
threshold). The freshest complete data may lag at most 24 hours. No empty,
small, stale, wrong-version, paginated or malformed sample counts as healthy.
Monitor evidence is source/run/version/fraction bound; a gap over one hour,
missing/failed prior report or ownership change restarts the dwell, never widens.
The 24-hour submission cooldown is separate from the per-stage dwell.

Vitals uses the existing service account with OAuth scope
`https://www.googleapis.com/auth/playdeveloperreporting`, against
`playdeveloperreporting.googleapis.com/v1beta1/apps/dev.tasknotes.app/{crashRateMetricSet,anrRateMetricSet}`
(GET freshness and POST `:query`). The Google Play Developer Reporting API must
be enabled in its credential project and the account must have **View app
information (read-only)** for TaskNotes. `store-status.yml` retains a bounded
`play-vitals-capability/play-vitals.json` probe: availability and HTTP status,
never Google payloads or identifiers.

If Reporting is unavailable, the named nearest signal is **Connect/CP/provider
readiness only**; this is not Android Vitals or device smoke. The monitor retains
that limitation and holds the current fraction; it does not widen on this
substitute. If exact-version Vitals is still unavailable/insufficient at 72 hours
of continuous observation at that stage (after publication), it halts the owned
staged version. Time waiting for store review does not consume the stage window.

A known boundary/Vitals failure or observed rejection halts **only the exact
owned in-progress version**, preserving the older completed release, and opens
only the Play stop even if the halt outcome is unknown. Halted versions never
resume automatically. Widening uses expected-fraction checks and cannot skip
10% → 50% or complete directly from 10%. Unknown ownership stops the line
without a speculative store write. Once 100% is completed, Play's staged-halt
mechanism is no longer available: failures **stop future Play publications**;
there is no automatic downgrade/rollback. Recovery needs a separately qualified
release/reconciliation plan from the release supervisor.

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
3. Have Callum or an agent manually check the **exact TestFlight or
   internal/alpha-track build** before Callum says go. Record the source SHA,
   store version/build and result; promote that same binary to production.
4. Read a fresh store plan and exact-run status/Vitals capability evidence.
   Reconcile any release-review or API-observation block; do not override it.
5. Tell Callum the exact platform, source SHA, SDK producer, artifact digest,
   store version/build, review state, notes and proposed 10% rollout/Apple release
   policy. Wait for go before enabling either line or submitting.
6. With authorization, enable only the chosen store, evaluate a fresh plan and
   dispatch through the existing publisher. Observe review, rollout and checks.
   Retain the bounded attempt and complete the normal deployment report.

Apple review and store policy/legal account attestations remain store-owned;
no workflow can grant approval or invent a legal response. No production
submission was made by this implementation.

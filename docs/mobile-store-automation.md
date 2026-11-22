# TaskNotes store production targets

Callum approved this policy on **2026-11-09**. Google Play and the Apple App
Store are ordinary production targets of ops App CD. They build qualified main,
submit automatically, and release automatically after the store approves. No
separate human submission approval, rollout ladder, health widening gate,
per-store cooldown, enable switch or GO packet remains.

## Ownership and exact source

Ops `app-cd.yml` → `app-publish.yml` runs the `google-play` and `app-store`
targets independently, including when TaskNotes web is already current. Ops uses
its normal newest-green main selection, app stop, authenticated production SDK
producer floor and both live-production server ancestry gates. It dispatches
`publish-tasknotes-store.yml` on main with exact `source_sha` and target, and
follows only the dispatch-returned first-attempt run. A store target never holds
the server, TaskNotes web, or the other store.

The store coordinator reads fresh store state before building. For Play, its
snapshot workflow shares the production edit lock, so a disposable edit cannot
invalidate a publisher's edit. Builds run the existing `android.yml` or
`ios-release.yml` from protected main with that exact candidate. Before executing
candidate dependencies, workflow-owned policy rechecks main ancestry, exact
main-push CI for that target, the committed SDK archive,
production trust and producer floor, and both app and target stops. The SDK's
existing digest/provenance/attestation checks and both signing identities are
unchanged. No production trust asset may rotate through this path.

The required commit checks have one definition: TaskNotes' `store_checks` in ops
`config/client-apps.json`. Play requires `ci.yml` and `android.yml`; Apple requires
`ci.yml` and `ios.yml`. The coordinator and protected builds read this ops policy
on main with the existing evidence token. The newest run's newest `run_attempt`
must be completed green for the exact source. The other platform and the
scheduled live-web `production-smoke.yml` are not target commit gates.
Each check is `{ "workflow": "ci.yml", "jobs": ["optional exact job name"] }`;
when named jobs are configured, they must all succeed in that same attempt.

The protected build retains an immutable source/version/build receipt. Signed
APK/AAB and IPA artifacts remain bound to that exact run. Publication rechecks
the receipt, successful build, main ancestry, CI, SDK and stops. The Android
uploader also verifies the entire Actions archive SHA256 before extracting only
its two expected signed files. Apple requires the exact successful TestFlight
upload and independently waits for the exact processed, store-eligible build.
The web publisher `deploy-tasknotes.yml` is unchanged.

## Only store-forced waits

One review/release may be in flight per store. Pending, processing, populated
draft, or approved-but-unpublished state quietly records `pending-review`; it
never stacks another release. Rejection records a failure and stops only that
target. Unavailable or malformed review evidence fails closed, except that an
unavailable Play lifecycle read quietly records `pending-review-unobservable`
when a retained successful same-target submission receipt and its requalified
signed build match the newest production-track versionCode, completed status and
release name. That submission may belong to an earlier source: the store permits
only one review in flight even when main advances. The code uses the publisher's
configured base plus that build's run number, never an unproven release or merely
a matching marketing version. It checks before qualifying or building the new
source. This outcome starts no write and dispatches no stop; it is not proof of
review or public availability. Missing or mismatched evidence still stops the
target rather than submitting blind. Play's **empty
DRAFT with zero artifacts**, including the existing internal-track placeholder,
is not a release in flight. No Console deletion is required or allowed as a
workaround. A draft with any artifact remains a blocker.

Play uploads directly to **production**, status **completed**, with no
`userFraction`: 100% on approval. Every commit retains
`changesInReviewBehavior=ERROR_IF_IN_REVIEW`; there is no review-cancelling
fallback. The production account must already have production access and
**managed publishing must be off** so approval actually publishes. App Store
submissions force **AFTER_APPROVAL**, disable phased release through the existing
checked submission policy, and never use a later manual release action.

The coordinator allocates a numeric marketing version strictly newer than the
observed live version (next patch, or a greater package version). With the
2026-11-09 status snapshot's package/live **1.0.12**, the first new submission is
**1.0.13** on each store. The signed build receives that version; no product
manifest edit or release tag is necessary. The bundled web build takes the same
version and its source commit from `TASKNOTES_STORE_VERSION` and
`TASKNOTES_STORE_SOURCE`, so More → About and the feedback report's
`build_revision` read `1.0.45-602fa92ec588`, never the frozen package.json
version (#492). Android version codes remain the
fixed configured base plus the Android workflow run number and must exceed all
store artifact codes. iOS build numbers remain the iOS release run number.
A retained successful same-source/live-version receipt makes subsequent ticks
`already-live`, rather than rebuilding the same source. Receipts retain for 90
days; preserve the ops deployment reports beyond artifact retention.

## Store listing text

Listing text and rolling release notes live in `store/listing/` (see its
README). Both publishers apply them inside the write they already make: the
App Store submitter on the new version and its editable app info before
submission, the Play publisher in the release edit before commit. Each reads
its writes back before submitting or committing; a mismatch fails like any
other saved-state mismatch. Edit the files, not the consoles. The first
release after a new locale is added creates that locale in the store.

Store screenshots and the Play feature graphic live in `store/screenshots/`
(see its README) and are uploaded the same way: the App Store submitter puts
them on the new version's primary locale and waits for Apple to process them
before submitting; the Play publisher puts them on the default language in the
release edit. Unchanged images are not uploaded again.

## Stops, outcomes and recovery

Use the ops front door:

- `bin/release app-line status|clear tasknotes` for the whole app;
- `bin/release app-line status|clear tasknotes-google-play` for Play only;
- `bin/release app-line status|clear tasknotes-app-store` for Apple only.

A pending, failed or missing target commit check is not selected by App CD; it
does not stop the line. A check changing before any build/write records
`store-unchanged` / `store-pre-submission-refused` in ops. TaskNotes retains its
`stopped` / `exact-main-ci-required` refusal with explicit `write_started: false`
but does not open an app-stop. Only no boundary or a successful read-only
`store-status.yml` boundary proves that refusal. Write evidence is persisted
before build/publisher dispatch, never inferred from a missing submission ID.
After a successful, requalified Android build, `write_started` returns to false
until publisher dispatch: an Android build alone does not write to Play. A parent
`app-line-stopped` refusal at that successful `android.yml` boundary is a quiet
hold, with no submit or store-line stop. Ops accepts that exact boundary only for
the Google Play parent-line refusal. Unknown/failed builds remain conservative;
iOS builds retain write evidence because they upload to TestFlight.

For infrastructure reasons allowlisted by ops `bin/lib/cd_retry.py`, an explicit
`write_started: false` refusal retains `outcome: stopped`, its reason and the
nonzero exit status without opening an app-stop. App CD verifies the retained
target/source/run binding, retries once after the backoff `cd_retry.py` sets for
that reason, and stops that store line if the retry fails or is refused. TaskNotes mirrors and test-pins the ops
allowlist because there is no shared contract file; fetching policy while
handling an evidence outage would add another failure dependency. A read-only
`store-status.yml` boundary may remain `dispatch-unknown` or `waiting` without
self-stopping when `write_started: false` and the reason is retryable. Explicit
unknown outcome/identity reasons and unknown or waiting write boundaries still
self-stop, even if an ops allowlist entry would otherwise match. A started or unknown write,
non-allowlisted reason, or store rejection also keeps its existing stop behavior.

The Play publisher's first step re-reads lines, source, SDK and review before
downloading or submitting anything. When that step refuses, it retains only
`{outcome: "refused-before-write", reason, source_run_id}` as
`store-target-result`; the artifact uploads on success or on that step's own
failure, never after a download or submit failure. Only for a completed, failed
`google-play-production.yml` run does the coordinator read that receipt, bound to
the exact signed source run, and record `write_started: false`,
`boundary_outcome: refused-before-write` and the child's reason. An allowlisted
reason then follows the retry rule above; any other reason still stops the line.
A missing, extra-field or mismatched receipt keeps `write_started: true` and the
`store-build-or-publication-failed` stop.

The App Store submitter retains the same bounded receipt when it refuses before
attempting any App Store Connect write (every non-GET request counts as an
attempt, even one that never reaches Apple). Its reason is a fixed slug such as
`app-store-build-not-eligible`, `app-store-build-processing-timeout` or
`app-store-version-needs-attention-<state>`; messages and response bodies never
leave the job. The coordinator records `boundary_outcome: refused-before-write`
and that reason, but keeps `write_started: true` because the TestFlight upload
is already a store write, so the line still stops with
`app-publication-failed`.

A failure after a write attempt retains
`{outcome: "failed-after-write", write_started: true, phase, http_status,
error_class, source_run_id}` instead, and the job log prints the same three
fields. `phase` is one of `version`, `version-localizations`,
`app-info-localizations`, `screenshots`, `review-details`, `read-back`,
`review-submission`, `confirmation` (or `unknown`); `http_status` is the status
Apple returned, or null; `error_class` is a fixed slug such as
`app-store-write-rejected`, `screenshot-processing-failed` or `error-typeerror`.
Apple's response body, request paths, ids and messages never leave the job. The
coordinator's refusal check never accepts this receipt, so the target keeps its
write-started stop; it only says where the next attempt should look.

A failed submission can leave an unsubmitted version in
`PREPARE_FOR_SUBMISSION` with some listing text or screenshots saved. The next
attempt reconciles it rather than waiting on it: the App CD queue check does not
treat a single such draft as in review; a rerun of the same version skips
localizations whose text already matches, creates only missing ones, and
replaces a screenshot set only when its ordered checksums differ; a new build of
that version is re-attached to the draft; and a later version adopts an older
draft by renaming it. A draft review submission is reused only when it contains
nothing but that version. Anything Apple has already received, a newer draft, or
more than one open version still waits as `pending-review` or refuses.

App Store Connect, not altool's wording, confirms a TestFlight upload. After
altool exits 0, `scripts/testflight-upload.mjs confirm` polls the API (about
ten minutes) for the exact build: the TaskNotes app and bundle id, the marketing
version and the build number. A listed build is success even when altool's
success phrase is missing; "No errors uploading" and "UPLOAD SUCCEEDED" are only
hints. A non-zero altool exit keeps the log-based classification. Before signing,
`testflight-upload.mjs preflight` refuses with `testflight-build-number-taken`
when App Store Connect already holds this or a higher build for the version. The
build number is the release run number and reruns are refused, so a retry after
an unconfirmed upload is a new dispatch with a higher build number.

When `ios-release.yml` cannot confirm a TestFlight upload, the altool log stays
on the runner because it can name the team, key and delivery. The job prints and
retains only `{outcome: "testflight-upload-refused", reason, run_id}` as
`testflight-upload-result`. The reason is a fixed class:
`testflight-build-number-duplicate`, `testflight-version-train-closed`,
`testflight-upload-limit`, `testflight-agreement-required`,
`testflight-auth-refused`, `testflight-service-unavailable`,
`testflight-transport`, `testflight-validation-itms-<code>`,
`testflight-build-not-visible`, `testflight-build-lookup-failed`,
`testflight-build-number-taken`, `testflight-upload-log-missing` or
`testflight-upload-unclassified`. Receipts from older runs may still carry
`testflight-success-unconfirmed`. For a failed `ios-release.yml` run, the
coordinator reads the receipt bound to that exact run and saves it as
`boundary_reason`. The upload may already have reached Apple, so
`write_started: true`, the `store-build-or-publication-failed` reason and the
`app-publication-failed` stop do not change.

A failed build, upload, signing/digest check, rejected review, or unknown dispatch stops the
selected store through those existing `app-stop` records. Unknown child writes
are never cancelled or redispatched automatically. Clear requires every
potentially writing build/publisher to finish; reconcile the exact attempt and
store state before clearing. A pending review is successful observation, not a
failure. A review raced at the final publisher also returns `pending-review`.

The coordinator retains `tasknotes-store-TARGET-RUN/store-cd-result.json`; ops
retains `app-cd-tasknotes-publish-TARGET-RUN/tasknotes.json` with the exact source,
child run and outcome (`submitted`, `pending-review`, `pending-review-unobservable`, `already-live`, `store-unchanged`, `stopped`).
Submission is not proof of public availability. Daily summaries should report
these outcomes, never relabel a pending review as a failed deployment.

## First live run and evidence limits

For the November 9 gate fix, merge the ops policy/selection fix first, then the
TaskNotes policy reader/refusal fix, with existing store holds left in place.
The supervisor owns reconciliation and clearing those holds after both land.
Neither merge authorizes an implementation agent to dispatch or clear a line.

The initial enrollment merged TaskNotes before ops; the gate fix uses the
ops-first order above.
The next eligible App CD tick (Actions fallback at minutes 7, 22, 37, 52; Worker
change/follow-up or hourly sweep) checks both store targets. Check current stops,
store review state, production access/managed publishing, existing signing
material and inherited Apple metadata/review contacts first. Environment branch
policies must admit main without a required reviewer or wait timer.

No live build, store dispatch or App CD run is part of implementation validation.
The supervisor owns the first live attempt, its exact receipts, and the normal
privacy-bounded deployment report. No physical-device or extra human GO gate is
introduced; platform review, account/legal interventions and rejected-review
remediation remain genuine store requirements.

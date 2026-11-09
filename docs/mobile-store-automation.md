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
target. Unavailable or malformed review evidence fails closed. Play's **empty
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
manifest edit or release tag is necessary. Android version codes remain the
fixed configured base plus the Android workflow run number and must exceed all
store artifact codes. iOS build numbers remain the iOS release run number.
A retained successful same-source/live-version receipt makes subsequent ticks
`already-live`, rather than rebuilding the same source. Receipts retain for 90
days; preserve the ops deployment reports beyond artifact retention.

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

A failed build, upload, signing/digest check, rejected review, or unknown dispatch stops the
selected store through those existing `app-stop` records. Unknown child writes
are never cancelled or redispatched automatically. Clear requires every
potentially writing build/publisher to finish; reconcile the exact attempt and
store state before clearing. A pending review is successful observation, not a
failure. A review raced at the final publisher also returns `pending-review`.

The coordinator retains `tasknotes-store-TARGET-RUN/store-cd-result.json`; ops
retains `app-cd-tasknotes-publish-TARGET-RUN/tasknotes.json` with the exact source,
child run and outcome (`submitted`, `pending-review`, `already-live`, `store-unchanged`, `stopped`).
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

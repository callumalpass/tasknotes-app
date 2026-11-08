# Android native qualification on hosted KVM — 2026-11-07

## Outcome: hardware lane established; qualification still blocked

Continuation of [PR #348](https://github.com/callumalpass/tasknotes-app/pull/348)
from `a21880eb739c045b1d121ee9e232ad023e50823d`. The PR remains a draft.
**Do not merge this as completed native qualification.** No signed qualification,
1.0.13 build, release tag or store publication is claimed. Production submission
remains disabled; no signing/trust key, SDK pin, store/legal declaration, server
line, iOS qualification or ops production configuration was changed.

## Hardware and native attempts

The proposed `ubuntu-latest` lane **does provide usable KVM**. The udev rule
needs `udevadm settle` before its permission check. The emulator runs with
`-accel on`; the actual emulator check reports **KVM (version 12) is installed
and usable**. This is not software CPU emulation or a desk-based substitute.

- [Run 42325594450](https://github.com/callumalpass/tasknotes-app/actions/runs/42325594450):
  KVM, emulator boot (about 37 seconds), Chrome and real app WebView attachment
  succeeded. Android 35 failed the public pre-sign-in app-ready assertion.
- [Run 42327811239](https://github.com/callumalpass/tasknotes-app/actions/runs/42327811239):
  the retained **pre-sign-in-only** screenshot expands the startup error:
  `Invalid application manifest: /installation_origins/production/mobile/0`
  must be an exact permitted origin. The declared value is
  `capacitor://app.tasknotes.dev`. No account input entered this preflight.
  This is an Android 35 bundled-WebView compatibility finding, **not** a
  demonstrated SDK/parser root cause or an Android 35 pass. No manifest origin
  was removed, parser overridden, or authority policy relaxed to make it pass.
- [Run 42328815217](https://github.com/callumalpass/tasknotes-app/actions/runs/42328815217),
  source `edc787133d855b16cb6bdc1979873357e4a3fcea`: **Android 36 preflight
  passed**, including Chrome, real native host and Sign in UI. Registered
  account sign-in and fixture selection ran. The driver then timed out at
  `fixture-approve`; it did not run CRUD. Inspection found that the portal can
  rename its button to `Open TaskNotes with <selected collection>`. The driver
  now accepts only the two exact application/owned-fixture labels, submits once,
  and does not wait for a Custom Tab navigation on that click. A closed tab is
  never accepted as approval proof; the original app must still complete its
  authenticated poll and real assertions. Regression tests cover one-shot
  dispatch, uncertain errors and native tab closure.
- [Run 42329978732](https://github.com/callumalpass/tasknotes-app/actions/runs/42329978732),
  source `60c9089293fcc73a550bc59a09e9fef69a2003dd`: Android 36 preflight
  again passed. **Sign-in, fixture selection and approval dispatch executed**;
  dispatch returning is not independently verified server approval. At
  **02:43:13Z–02:44:44Z** the lane timed out at `runtime-open`, before task
  creation, wasm initialization evidence or SQLite reopen. Its result is
  `status: failed`, `phase: runtime-open`, `cleanupPhase: cleanup-required`.
  The original installed app's post-approval open/handoff is still unqualified.
  Additional fixed resume/target/workspace/setup phases now narrow the next
  diagnosis. The final code also requires the selected approval receipt to
  name the exact owned fixture before dispatch. These changes have no new
  credentialed runtime pass and do not manufacture one.

The second attempt is the last login attempt on **prod-a** in this task:
**two of two used**. No further login is authorized on that account for this
continuation. No screenshots, traces, DOM, console, traffic or storage dumps
were collected from the credentialed journey. Its retained JSON has only fixed
phases/status, not the raw Playwright exception.

## Exact final debug identity — not a signed release

Run **42329978732**, source
`60c9089293fcc73a550bc59a09e9fef69a2003dd`, built **debug 1.0.12 / code 1**:

- build artifact ID **13556927938**;
- artifact name `tasknotes-android-debug-60c9089293fcc73a550bc59a09e9fef69a2003dd`;
- archive digest `sha256:10d3541089587a647dbca45e683a51eb194428b1e927e5f26dcb407cc2b3a444`;
- APK SHA256 `770d6b17e27d91e99560323956444ae2d442b7412f84489e9b3f8d5f6f8a0a68`;
- test-host APK SHA256 `93b4846974c101f0146b687aac9929ad57184c985223b449c31b43fd89e178e8`;
- journey artifact ID **13556654498**, digest
  `sha256:bccf5f753416e1341dea0f91c51b5a89f48d686b82ad6242a92290bfc126f5b9`.

The archive digest and both extracted APK hashes were independently rechecked
against the retained download. No `qualification.json` was emitted. No new signed
source run or signed artifact identity exists.

The unchanged SDK is **@mdbase-dev/sdk@0.1.0-beta.158**, producer
`373c4a4e78e821e45a330e156a019a7aa635cfe8`; its committed archive still hashes to
`3742d3770953f2da5381d94265b0bb7c85103ad8690f7ddaa7d2c8b583538e24`.

## Producer implementation — wired, not runtime qualified

The draft now contains a same-run signed producer and release-workflow wiring:

- `android-signed-artifact.mjs`: exact repository, source run/attempt, tag,
  source SHA, artifact ID/name and API metadata bindings; independently compare
  downloaded ZIP bytes with both API and upload-output digests.
- `android-artifact-extract.py`: bounded extraction of only the expected APK/AAB
  or test APK; reject extra/missing/duplicate/traversing/link entries.
- `qualify-android-signed-artifact.mjs`: verify release package/version and
  non-debuggable status, verify matching application/test-host certificates,
  install retained APK bytes, pull the installed APK and compare its hash,
  execute the real journey, then emit proof only on complete verified success.
- The release job builds the test-only release instrumentation host with the
  **existing** signing identity. A separate environment-scoped job receives no
  signing key, downloads the retained artifacts by ID, and uploads
  `tasknotes-mobile-wasm-android/qualification.json` only after success.

`assertWasmProof` and **all of `scripts/mobile-release-policy.mjs` are unchanged**.
The producer invokes that existing consumer assertion before emitting proof.
Wrong source/repository/attempt, expired artifacts, digest tampering, unsafe ZIPs,
missing exercises and unverified cleanup have regression coverage. The signed
producer has **not run successfully on a real signed artifact**. Compilation and
unit tests are not signed runtime qualification.

## Fixture reconciliation and cleanup: verified

Only owned GCP desks `gcp/tn-native-ledger` and `gcp/tn-native-fixture` were used
for owner-browser preparation/cleanup. No minipc or `gcp/montage` was used.
Existing registered owner sessions were checked; neither desk submitted a
password login. Chrome sandbox status was checked before fixture mutation.

1. The prior retained fixture `[test] agent-20261106-native-wasm-ci` was read
   through the real Editor using owner-authorized access. Its UI inventory was
   **five default TaskNotes base-view notes, six types, zero task notes and zero
   attachments**: not an empty collection. Owner deletion removed it from a
   fresh account overview. Only the new Editor installation used for this read
   was revoked; all prior installations were preserved.
2. The CI fixture `[test] agent-20261107T015526Z-android-native` was initially
   verified as **zero notes / zero files**, with an owner-enrolled Editor held
   for cleanup. After both CI attempts a fresh owner read still showed **zero
   notes / zero files**, no active TaskNotes installation scope and no active
   legacy grant on the fixture. This does not prove server approval succeeded.
3. At **2026-11-07T02:46:59Z**, owner deletion of the CI fixture returned
   **HTTP 200 / deleted=true**. Fresh reads verified the fixture and its owned
   Editor installation absent, **zero new installations** relative to the
   pre-run ledger, and every prior installation preserved. The CI cleanup
   failure is independently reconciled, not relabelled as a passing CI result.

Both fixture reconciliations and the exhausted login budget are recorded under
the private account registry's lock. Both desks have summaries and are destroyed.
There was no account-wide sign-out or unrelated revocation. Deletion here means
the product's permanent access-denying soft delete, not physical storage erasure.

The purpose-scoped `android-native-qualification` GitHub environment was limited
to this draft branch and Android release tags. Its `TASKNOTES_NATIVE_ACCOUNT`
secret was populated directly from the registered account without printing it,
then **deleted after cleanup**. No credential remains available to accidentally
run against the deleted fixture. A future authorized attempt must provision a
fresh owned fixture and purpose-scoped secret from the registry; this is not a
request for a human to paste credentials into chat.

## Validation and exact next steps

On the final source changes following code head
`876cf97155b3f1dbda69645bfb93050fd736a2a3`, remote
`rpnpm run verify` passed: release Node **480 passed / one skipped**,
app **201 files / 1,529 tests**, layer **137 and 251 tests**, conformance
**4,982 passed / one skipped**, plus catalogues, formatting, types, lint and
production build. An earlier remote run hit a transient empty-package JSON
read; retain that failure, not a claim of first-attempt green. Fixed diagnostic
phases and the selected-receipt guard do not constitute a runtime re-test.

Latest exact-head iOS and production-smoke PR jobs at that code head passed.
The Android PR build failed an unrelated existing image-download alert test in
`src/app/task-screen.test.tsx`; normal exact-head CI must be green before any
merge. An earlier web-publisher ancestry check also failed; its later exact-head
`TaskNotes CI` passed without any changes here to the web publisher or #1223 hold.
No production web publish was attempted.

Remaining implementation order:

1. Diagnose the **post-approval `runtime-open` deadline**, recording only bounded
   approval status and original native target/owner phases. Do not retry the
   approval write, inject callback authority, replace the SDK owner, strip
   declarations or infer initialized wasm from loaded files. Preserve and
   separately resolve the Android 35 startup compatibility finding.
2. On an authorized fresh account/fixture budget, pass actual create/edit/read,
   old-Worker retirement, SQLite reopen and cleanup. **Do not retry prod-a in
   this task.** No privileged server access or signing/trust change is needed
   or authorized as a shortcut.
3. Finish the producer's regression coverage/workflow review and all harness
   runtime corrections. Retire the draft-branch-only debug dispatch/fast-build
   route before merging the permanent signed producer. Obtain normal green
   exact-head PR CI after the real debug journey passes. Only then squash merge using GitHub's full head SHA with
   `gh pr merge 348 --squash --match-head-commit <sha-from-gh> --delete-branch`.
4. Prepare **1.0.13** through normal green main and the existing signed Android
   tag pipeline with beta.158, a fresh scoped fixture/secret and that run's
   passing artifact-bound proof. Verify the producer on those retained signed
   bytes in that same run; a failed producer must fail the source run. Return
   its exact signed build identity to the
   release supervisor. No production GO, submission or promotion is granted.

Human/out-of-scope lanes remain: **Play Console owner sign-in** to inspect and
discard the reconciled empty internal draft; and an authorized **physical or
TestFlight device lane for iOS**. No store/legal attestation was made.

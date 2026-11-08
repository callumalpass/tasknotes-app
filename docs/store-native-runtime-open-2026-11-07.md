# Android runtime-open investigation — 2026-11-07

Continuation of [the hosted KVM attempt](store-native-hosted-kvm-2026-11-07.md)
and [the earlier qualification report](store-native-qualification-2026-11-07.md),
from draft [PR #348](https://github.com/callumalpass/tasknotes-app/pull/348) at
`56dbd507a573eb53f58d378ca502aa02e17ed62e`.

## Decision: blocked; do not merge or release

**The original `runtime-open` root cause remains undetermined.** The retained
original result did not prove completed server approval. The new attempt failed
before completed approval, so it does not reproduce a post-approval SDK open.
There is insufficient evidence to assign the original failure to the app or SDK,
or to assert user impact or P1/P2/P3 severity. It must not be described as a fixed
SDK defect, a passing native journey, or merely slow runtime initialization.

No CRUD, SQLite reopen, signed runtime qualification, merge, 1.0.13 build, tag or
closed-testing publication occurred. No production submission/promotion/web
publish occurred. Production-disabled settings and all of
`scripts/mobile-release-policy.mjs` are unchanged. No SDK, server, ops, signing or
trust keys, store declarations/legal attestations or iOS product code changed.
The Connect #1223 production-web hold remains in force.

## What the new attempt actually establishes

[Run 42333609739](https://github.com/callumalpass/tasknotes-app/actions/runs/42333609739),
at source `5f344da871dae236fbd1eb510a7c0cd4ebafb0f6`, attempt **1**, run number
**809**, used hosted KVM and Android **36**. Native preflight passed. The
registered-account journey reached fixture selection and its exact selected
receipt. Then:

| Assertion                                  | Result           | Evidence                                                                                                                |
| ------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Explicit production environment            | PASS             | `/health`: production, `https://connect.mdbase.dev`, revision `4af641695de2e6de0d5674f715dd1eccb8d03aa6` at preparation |
| Native sign-in and exact fixture selection | PASS             | Fixed phases through `fixture-selection-confirm` and `fixture-approval-ready`                                           |
| Completed approval                         | FINDING          | Original pairing was `pairing-account-unconfirmed` at **03:28:48.264Z** and **03:30:19.901Z**                           |
| Original native UI                         | FINDING          | `native-ui-authorizing` at **03:30:19.916Z**, not an opened collection                                                  |
| Harness approval dispatch                  | FINDING          | Failed at `fixture-approval-dispatch`, approximately 90 seconds after the click began; no `runtime-open` phase reached  |
| CRUD / SQLite reopen                       | FINDING, blocked | No task/model write or old-Worker/new-Worker/reopened-read assertions executed                                          |
| Journey access cleanup                     | PASS             | Final phase `native-host-close`, not `cleanup-required`; independently reconciled below                                 |
| Same-run signed qualification              | FINDING, blocked | Release and signed-qualification jobs skipped on this debug dispatch; no `qualification.json`                           |

The new failure is in the harness's approval-dispatch stage, **not evidence of
an SDK runtime-open defect**. Its original exception was intentionally discarded
for privacy; the existing retained result cannot identify the click's specific
actionability cause. In particular, no viewport, keyboard, pointer-interception,
SDK-attestation or application-return hypothesis has been established as root
cause. Do not replace the click with forced/scripted approval, replay an unknown
approval, inject callback authority, replace the SDK owner, or bypass assertions.

The run used the unmodified production-targeting harness and SDK trust. Staging
credentials are not valid substitutes for this build. Account **prod-a** was not
used. Account **prod-b** used exactly two password logins: one successful owner
management preparation and one native CI sign-in. **Both account budgets for
this work are now exhausted.** No signups or quota/entitlement changes occurred.

## Exact tested identity: debug only

Independently downloaded ZIP bytes match the API artifact digest. `aapt` on the
retained APK reports package **dev.tasknotes.app**, version **1.0.12**, code **1**,
compile SDK **36**. It is not the requested signed 1.0.13 release.

- Build artifact ID: **13558531305**.
- Name: `tasknotes-android-debug-5f344da871dae236fbd1eb510a7c0cd4ebafb0f6`.
- ZIP digest: `sha256:2c11d2ad5d1e19324798cdd008e3a135d592d894beeeb5e209c58d53282c65cd`.
- Application APK SHA256: `2d62a7094c0ba9b7e0b8c3461247804a401c5975b518bd2d2a1178cc62ffcdfa`.
- Test-host APK SHA256: `5210eaf1b74bee355174a7a2a14bdd6499892e0bbf87ace8050b2a139619478d`.
- Journey artifact ID: **13559260751**; digest `sha256:15f75ea621bae454c5b3a52d649cdeb67405ace829df49803abc83be43a29d99`.
- SDK: **@mdbase-dev/sdk@0.1.0-beta.158**, producer `373c4a4e78e821e45a330e156a019a7aa635cfe8`, unchanged archive SHA256 `3742d3770953f2da5381d94265b0bb7c85103ad8690f7ddaa7d2c8b583538e24`.

## Implementation and validation

Only the qualification harness and its tests changed:

- Observe the original server pairing with a read-only, in-page reduction to
  fixed approval states; distinguish account confirmation, attestation and
  exact owned-target approval from a returned click.
- Retain fixed native UI phase observations, bounded to twelve enum/timestamp
  entries. Unknown observer values and private error text are dropped.
- Add fixed actionability classification for future approval failures. This
  classifier was added **after** the native attempt and has unit coverage only;
  it is not evidence about that attempt's discarded exception.

Initial remote verification failed on two `location` lint errors introduced in
the observer. They were corrected to `globalThis.location`; the failure is not
relabeled as a first-attempt pass. On final code head
`dba03996e9ca19b1444265edca79d62fb7939603`, `rpnpm run verify` passed:

- release Node suite: **483 passed, one existing skip**;
- application suite: **201 files / 1,529 tests passed**;
- layer suites: **137 and 251 passed**;
- collection conformance: **4,982 passed, one existing skip**;
- catalogue, format, typecheck, lint and production build gates passed.

Normal exact-head PR CI at that code head passed TaskNotes CI, production smoke,
iOS and Android (including noncredentialed native preflight). That green CI is
**not** a credentialed CRUD/reopen or signed qualification pass. Later report-only
commits still require their own exact-head green CI before any eventual merge.

## Owned-resource reconciliation: complete

Run **agent-20261107T031754Z-3417526**, production, owned GCP desk
**gcp/tn-native-open** with blank environment-specific profile. Chrome process
arguments and `chrome://sandbox` were checked before credentials. No minipc,
`gcp/montage`, other lane's desk or existing personal client was touched.

The account had zero owned hosted collections before this lane. Exactly one
new fixture, `[test] agent-20261107T031754Z-3417526`, was created; no other fixture
was mutated. The native run created no TaskNotes installation or task. Fresh
owner reads before Editor enrollment verified zero fixture installations and
zero active legacy grants. Owner Editor approval was scoped only to this
fixture; it reused the existing owner session without a further password login.
The Editor's exact owned target and empty-collection prompt were verified before
deletion; no full record inventory or numeric notes/files count is claimed.

A management-session delete returned **HTTP 401**, a definite refusal; it was not
replayed or treated as deletion. The original owner-authorized Editor SDK's
normal **Delete collection** confirmation subsequently completed. A fresh owner
read verified the fixture absent. After deletion its newly owned Editor
installation became an unscoped row; the already recorded exact owned connector
was revoked, with no unrelated scope or installation touched.

At **2026-11-07T03:48:36.841Z**, fresh reads verified:

- fixture absent;
- owned access absent and zero new installations relative to the baseline;
- no active fixture legacy grants;
- **every prior installation preserved**.

Owned browser logout returned **200**, followed by `/v1/me` **401**. The scoped
`android-native-qualification` secret was deleted and its absence rechecked;
the local credential input was removed. The account budget and cleanup result
were recorded under the registry lock without printing credentials or registry
contents. The desk received a bounded summary and was destroyed. No account-wide
sign-out or revocation was used. Deletion means the product's permanent
access-denying soft delete, not physical storage erasure.

## Exact continuation blocker and order

1. **`native-debug-journey` → `fixture-approval-dispatch`: fresh explicit
   registered-account/login budget is required.** Neither prod-a nor prod-b may
   be password-logged-in again under this task's current authorization. The
   attempt must use a fresh owned fixture with owner cleanup authority and a
   freshly provisioned purpose-scoped CI secret; the old fixture is deleted.
   The new fixed click classifier and finer runtime phases have not had a
   credentialed native run. First establish whether the click actually dispatches
   and the original server request completes approval, then diagnose any real
   post-approval native opening failure. Do not merge merely to get past this.
2. Pass real CRUD, old-Worker retirement, SQLite reopen/read and owned cleanup.
3. Complete signed runtime verification against the same-run retained artifact
   ID and digest under the unchanged release policy. No signed runtime pass is
   currently available; compilation/unit tests cannot replace it.
4. Retire the temporary draft-only debug dispatch/fast-build path, obtain normal
   exact-head green PR CI, and only then merge using GitHub's full head SHA and
   the required `gh pr merge 348 --squash --match-head-commit <sha> --delete-branch`.
5. Prepare 1.0.13 through normal green main and the existing signed pipeline,
   with beta.158 and that same run's retained artifact ID/digest-bound runtime
   proof. No such signed artifact identity or closed-testing handoff exists yet.
   Production GO/submission/promotion stays exclusively with the supervisor.

Out of scope: **Play Console owner sign-in for the empty internal draft**; and
the **physical/TestFlight device lane for iOS**.

# Native qualification follow-up — 2026-11-07

## Outcome: blocked, not qualification and not a release

PR [#348](https://github.com/callumalpass/tasknotes-app/pull/348) remains a draft.
No CRUD/reopen pass, signed-artifact qualification, 1.0.13 build, tag, closed-test
publication or TestFlight upload is claimed. Do not merge this as qualification.
Production submission remains disabled. No signing/trust keys, store declarations,
legal attestations, server line or mdbase-cloud-ops production were changed.

## Driver fixes and their limits

Source inspection found independent defects in the prototype:

- It initialized the TaskNotes model only when also creating a new collection.
  A retained empty fixture could therefore wait forever for `New task` while
  displaying `Set up`. Collection creation was removed from this driver; an
  existing explicitly named test fixture is required. Model setup is submitted
  once, outside the polling callback, including for a retained fixture.
- `AndroidWebView.page()` caches its first Page. Looking it up again does not
  reacquire a replacement document after Activity recreation. The driver now
  retains the CDP context and selects a live, exact-app-origin replacement.
- Capacitor's `BridgeActivity.onDestroy()` does not itself call
  `WebView.destroy()`. The test-only host now explicitly destroys the original
  WebView before Activity recreation. The driver still requires original Worker
  closure and a different Worker, and opens/reads the owned task after reopening.
- The delete journey omitted `More task actions` and the `Delete` menu entry.
  It now uses the real confirmation path and waits beyond the 30-second undo
  window. Failure cleanup checks the exact owned title, never retries an unknown
  delete, and preserves access if task cleanup cannot be verified.
- Installation cleanup snapshots the authenticated registered account before
  approval, revokes only newly observed TaskNotes installations scoped exclusively
  to the owned fixture, and re-reads absence. Ambiguous/mixed scopes refuse cleanup.
  Cleanup failure refuses a passing result. No account-wide revocation is used.
- Chrome startup now has a bounded deadline. Loaded wasm resource paths alone
  no longer set the runtime-initialized flag; flags follow the actual task write
  and reopened-document read.

These changes have regression coverage, **not a passing real native journey**.
In particular, they are not a verified diagnosis of the earlier handoff failure.
The signed-artifact download/digest-binding producer and signed-workflow
integration are still unimplemented.

## Validation

On the final source changes, `rpnpm run verify` passed (exit 0):

- release Node suite: 443 passed, one existing skip;
- app coverage suite: 201 files / 1,529 tests passed;
- layer suites: 137 and 251 tests passed;
- collection conformance: 4,982 passed, one existing skip;
- catalogue, formatting, typecheck, lint and production build gates passed.

Lint retains the existing Fast Refresh warning in the private-account e2e fixture.
Local JDK 21 compilation of the modified test-only host passed
`:app:assembleDebugAndroidTest`. `git diff --check` passed. PR CI must still be
checked at the newly pushed exact head; old green checks do not qualify it.

## Actual native attempt: infrastructure/blocked

Only the owned isolated GCP desk `gcp/tn-native-qual` was used for native testing.
Neither minipc nor `gcp/montage` was used. The GCP host/container exposed neither
KVM nor VMX, so the Android 36 emulator used software CPU emulation. It eventually
booted and installed both APKs, but exhibited a **System UI isn't responding**
dialog and did not expose the expected Chrome debugging socket.

The final bounded attempt ran **2026-11-07T01:12:45Z–01:14:34Z**, returning:

- status: failed;
- phase: `browser-start`;
- category: `native-browser-start-deadline`;
- host cleanup phase: `native-host-close`.

It stopped **before native host launch, sign-in, approval, model setup or CRUD**.
The outer runner watchdog bounded the outstanding Playwright startup operation;
owned runner/emulator processes were explicitly stopped and the private account
input file removed. This is an infrastructure finding, not an app defect or pass.
No `qualification.json` was emitted.

The installed application was a **debug 1.0.12 development build**, not a new
signed release or an artifact that can be promoted:

- application APK SHA256:
  `a84c6a8358d18e6dcc0a67575a7627759a55b54b90c2a2f23a720579d520281b`;
- modified test-host APK SHA256:
  `4bb05e7d3ff28b5828209b7835398fa5b36e5be248bf0e0c7880cb69fa221eb7`.

No signed source run, build artifact ID or artifact digest has been allocated.
The pinned SDK remains `@mdbase-dev/sdk@0.1.0-beta.158`, producer
`373c4a4e78e821e45a330e156a019a7aa635cfe8`; the committed archive SHA256 was
independently rechecked as
`3742d3770953f2da5381d94265b0bb7c85103ad8690f7ddaa7d2c8b583538e24`.

## Prior fixture access cleanup: verified; fixture content still unverified

Using only registered account alias **prod-a** and its authenticated public
management API, the retained fixture `[test] agent-20261106-native-wasm-ci` had
exactly two TaskNotes installations from the earlier attempt window. Each
connector covered only that fixture. Both revocations returned HTTP 200; a fresh
overview verified both absent and **zero active legacy grants** for the fixture.
A second fresh read after the native attempt again found **zero installations
and zero active legacy grants** for that fixture.

No other application's grants, installations, computers or account sessions were
revoked. The native attempt did not reach sign-in and created no new grants/tasks.
The account registry was updated under its lock to preserve this cleanup result.

**The fixture itself remains retained for content verification.** Its record
contents/emptiness were not proved, and it was not deleted speculatively. Complete
an owner-authorized content read and deletion (or explicitly register a persistent
CI fixture) before further production fixture mutation. This remaining item must
not be reported as completed fixture cleanup.

## Fresh store observation and exact remaining steps

Read-only protected-main [Store status run 42320557893](https://github.com/callumalpass/tasknotes-app/actions/runs/42320557893)
completed successfully at source `16c9c29901e9fe88c7987f18daa080e65899cc81`:

- production and alpha remain published at **1.0.12 / 100738**;
- internal remains **DRAFT with no version codes**;
- review observation is available;
- Vitals is available but **insufficient**, not a passing health sample.

An isolated GCP store desk reached the Google account sign-in boundary, not an
authenticated owner Console. No draft/track mutation was attempted. Exact access
step if existing agent-authorized owner access is unavailable: authenticate the
existing authorized Play account in the isolated GCP desk. Then the agent can
inspect **Play Console → TaskNotes → Test and release → Internal testing** and
**Publishing overview**, establish the empty draft's ownership/history, discard
only the reconciled owned empty draft, and run fresh store observation. Unknown
ownership remains a line stop; do not suppress the queue guard.

Remaining implementation work (not replaceable by human approval): obtain a
working authorized accelerated GCP native lane; pass the real app's CRUD/reopen
and cleanup; finish the same-source-run exact-retained-signed-artifact
ID/digest-bound producer and its regression tests; then merge through exact-head
green PR CI. Only afterwards prepare 1.0.13 through a normal green main PR and the
existing signed pipelines, and qualify the exact new artifact before the
closed-testing handoff.

For iOS, an existing authorized physical/TestFlight device lane is still needed
to exercise the exact distribution IPA. A simulator rebuild or a new signing/
provisioning identity is not a substitute. Providing that existing authorized
device access is the exact external access step; the artifact-bound runner itself
is still implementation work. TestFlight upload is not native qualification or
public release. Production GO and Apple's later MANUAL release stay with the
release supervisor, outside this task's authorization.

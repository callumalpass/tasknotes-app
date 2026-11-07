# Store automation blocker follow-up — 2026-11-06

## Outcome: two blockers closed; native qualification remains blocked

Production remains disabled. No production submission, release tag, signing
identity change, trust-key change, service-account key creation or key rotation
was performed. The release supervisor, not the account owner, owns production GO.

Merged fixes:

- [#345](https://github.com/callumalpass/tasknotes-app/pull/345): exact-live-version
  Vitals observation and bounded review failure phase/status.
- [#346](https://github.com/callumalpass/tasknotes-app/pull/346): handle empty-track
  HTTP 204 responses without inventing published production evidence.

## 1. Android Vitals: closed

Enabled `playdeveloperreporting.googleapis.com` on the existing Play credential
project using the machine's already authenticated `gcloud` owner access. No
credential, IAM grant, signing or trust changes were needed for API activation.

Protected-main [run 42306938206](https://github.com/callumalpass/tasknotes-app/actions/runs/42306938206)
read the live version **1.0.12 / 100738** successfully and returned
`available: true`, `verdict: insufficient`. This is **not enough data**, not a
passing health sample. The status workflow now supplies the sole live version
code to the Vitals reader; it no longer just checks metric-set access.

The final protected-main
[run 42312964510](https://github.com/callumalpass/tasknotes-app/actions/runs/42312964510)
again returned `insufficient`. Existing rollout rules still forbid widening on
insufficient data. No lowered thresholds or health substitutions were introduced.

## 2. Play review observation: closed

The method exists in Android Publisher **v3**; its URL and OAuth scope were
correct. There were two independent live failures:

1. An empty track returns **HTTP 204**, not JSON `{}`. The old observer dereferenced
   `null.releases`, caught the TypeError and reported an unspecified failure.
   Only summary GET 204s are now normalized to empty lists. Production still
   requires a positive published summary matching its live artifact codes.
   Mixed-track and all-empty regression tests protect that distinction.
2. After fixing that bug, live observation exposed **HTTP 403**. The existing
   service account already had TaskNotes app-level **Admin (all permissions)**,
   but no account-level read grant. Through the owner's existing signed-in
   **Play Console → Manage account → Users and permissions → existing publishing
   service account → Account permissions**, enabled exactly:
   **View app information and download bulk reports (read only)**.
   Saved and confirmed that change through the Console. This is an
   **account-level** read permission, not a TaskNotes-only grant; it applies to
   apps in that developer account. All existing app grants were preserved.
   No account-admin, publishing, financial, signing, IAM or key grant was added.

The first fresh probe after that permission change,
[run 42312964510](https://github.com/callumalpass/tasknotes-app/actions/runs/42312964510),
reported `review.available: true`:

- production: `PUBLISHED`, code 100738;
- alpha: `PUBLISHED`, code 100738;
- internal: `DRAFT`, no active artifacts.

That is a real answer, not a permission bypass or a track-state substitute.
The conservative queue still holds on the internal draft as an earlier in-flight
release. Its ownership must be reconciled before removing it; this work did not
speculatively delete someone else's draft. No rejection or in-review release was
reported by this snapshot.

## 3. Native proof: not closed, do not merge the prototype as qualification

The draft contains a **test-APK-only** `NativeWasmHostTest` and an Android journey
prototype, not a completed signed-native producer. Android's instrumentation
signature check is preserved; no shipping debug flag, product test route,
protocol stand-in, runtime replacement or authority override is added. PR CI
also compiles the debug instrumentation APK.

Local checks used an isolated `tasknotes-store-proof` Android 16 emulator opened
through T3 `device_list` / `device_open`. The historical signed 1.0.12 APK was
used only as an installation baseline, never as beta.158 proof. Current main's
production web assets were built with `rpnpm --pull dist run build`, synced into
Android, and the debug application and instrumentation APK compiled with the
existing JDK 21. That **debug** application is not a qualified signed release.

The real app could reach its normal native workspace. Automated qualification
has not passed: the driver encountered Custom Tabs/default-profile isolation,
stale/closed WebView targets during sign-in, and a runtime-open deadline. No task
create/edit/reload or SQLite reopen assertion passed. No `qualification.json`
was emitted, and no signed build was dispatched.

Still required before this prototype can merge as a producer:

- Stabilize the actual browser/native handoff on a clean emulator without
  retrying unknown writes or losing the SDK's original owner.
- Complete and test owned-task cleanup on **failure**, plus installation/grant
  cleanup. A finally block that merely stops the host is not sufficient.
- Observe actual initialized runtime/SQLite execution and database reopening
  after retiring the original Worker; loaded resource paths alone must not
  become passing exercised proof.
- Download and verify the exact retained signed artifact within its own source
  build run, verify installed APK bytes, and bind the resulting evidence to the
  GitHub artifact ID and digest. The draft currently has no artifact-bound
  producer wrapper or signed-workflow integration.
- Run the lane successfully on the exact signed release, with the existing
  signing identity. Keep the normal CI and consumer guard fail-closed.
- For iOS, obtain an existing authorized physical/TestFlight device lane. The
  available T3 host has no iOS support; a simulator rebuild cannot qualify the
  distribution IPA. Do not change provisioning/signing identities to manufacture
  device access; return such a proposal to the release supervisor first.

### Test-resource ledger

Only the registered production test account alias **prod-a** was used. One empty
owned collection, `[test] agent-20261106-native-wasm-ci`, was created for the
intended CI lane. No task CRUD was reached. Retain this fixture only as a
registered persistent CI fixture, or delete it during reconciliation. Native
installation/grant cleanup is **not verified**. Stop further production test
mutation until that ledger is reconciled; do not revoke unrelated TaskNotes
installations or grants on the shared account.

## What remains human, and what does not

There is no observed current store rejection in the final snapshot. Reading a
rejection is not inherently human-only when existing authorized access reaches it:

- **Play Console → TaskNotes → Publishing overview / Policy status → rejection
  details**: agents may read privately, repair routine code/metadata failures and
  prepare a response. The release-summary API does not include the explanation.
- **App Store Connect → App Review → rejection message / Resolution Center**:
  agents may read privately and prepare routine repairs/responses. The status
  API does not expose the full conversation.
- A responsible human must approve any **appeal or rejection response that makes
  new legal, ownership, rights, privacy, identity or policy attestations**.
  Agents must not invent such assertions or treat store rejection as permission
  to rewrite declarations. Store approval itself remains Apple/Google's decision.

The responsible account/legal human retains these decisions **when required or
changed** (this is not a claim that every form below is currently outstanding):

- Google Play **developer identity/contact verification**, **Declare your trader
  status / DSA verification**, and acceptance of **Developer Distribution
  Agreement / updated terms**. The trader-status banner was visible in Console;
  no declaration was made here.
- Google Play **Data safety**, **content rating**, **target audience and content**,
  and restricted-permission/policy declarations requiring factual/legal signoff.
- Apple **Developer Program / App Store Connect agreements**, **DSA trader status
  and identity**, **export compliance / encryption**, **App Privacy**, **content
  rights**, and **age-rating declarations** requiring factual/legal signoff.

Existing reviewed declarations may be preserved; automated metadata preparation
is not a new legal attestation. The **release supervisor** owns initial production
GO and the later deliberate Apple MANUAL-release decision. Those are not requests
for owner approval. Agents may perform authorized store actions after the gates
and that supervisor decision; they cannot grant themselves GO.

## Exact plan to return to the release supervisor — still blocked

- **Build:** no new qualified signed build exists and no new source run/artifact
  identity is allocated. Do not reuse Android 41615558432 / 100738 or iOS
  41615565002 / build 30 as new proof.
- **Version:** **1.0.13**, via an ordinary green main version PR, then the existing
  Android tag/closed-testing and iOS/TestFlight pipelines. No version bump or tag
  was made during this partial follow-up.
- **SDK:** retain **@mdbase-dev/sdk@0.1.0-beta.158**, producer
  `373c4a4e78e821e45a330e156a019a7aa635cfe8`, archive SHA256
  `3742d3770953f2da5381d94265b0bb7c85103ad8690f7ddaa7d2c8b583538e24`.
- **Wasm proof:** absent. Require same-run, exact-signed-artifact ID/digest-bound
  exercised runtime initialization, SQLite query/write/reopen, task
  create/edit/reload, and verified cleanup. Debug/protocol/simulator substitutes
  and manually supplied passing JSON do not qualify.
- **Rollout:** reconcile the internal draft and test ledger, finish native proof,
  build through green normal CI, complete closed testing/TestFlight, then return
  exact build IDs/digests and a fresh source/review/Vitals/cooldown plan. Wait for
  **release-supervisor GO**, not owner GO, before enabling or submitting either
  production line. Play: 10%, 50% after 24 continuous monitored hours, 100% after
  another 24; sufficient fresh exact-version Vitals required at each widening.
  Monitor through seven days. Apple review and MANUAL release remain separate.
- **Halt:** boundary/Vitals failure halts only the owned staged Play version and
  opens its isolated Play hold. Missing/insufficient Vitals holds the fraction,
  then halts after 72 continuous monitored hours at that stage. Halted versions
  do not resume automatically. Unknown ownership is a line stop, not a speculative
  write. After completed/100%, stop future publication and prepare a separately
  qualified recovery; no automatic downgrade. Apple rejection stops only iOS,
  not the server or Play.

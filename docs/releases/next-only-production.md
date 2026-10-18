# Next-only production candidate — release candidate, blocked on production trust

This candidate merges the 1.0.7/1.0.8 release fixes and draft-preserving update
reload into the next-only app. It does not implement a dual-backend fallback.
The version remains 1.0.9. Callum has confirmed next-only clients and one bounded production migration
window, with the app released at its end. Do not merge or submit without the
explicit release GO and the gates below.

## Production build and trust input

`pnpm build` runs an offline production SDK preflight before building. It then
sets `VITE_TASKNOTES_ENVIRONMENT=production` and
`VITE_TASKNOTES_EDITOR_ORIGIN=https://editor.mdbase.dev`.
Web runs at exactly https://app.tasknotes.dev; native iOS runs at exactly
capacitor://app.tasknotes.dev, including WebKit's opaque-origin representation.
The manifest's publisher origin remains HTTPS; the declaration identifies the
actual native host. LAB origins are never a production fallback.

### What the SDK now provides

The SDK (mdbase-next main, including #894 and #896) supports production
packaging. Its release pipeline embeds mdbase's production trust when it
builds the SDK. Apps never handle trust: they update the SDK pin and lockfile
and rebuild. A source-only SDK build contains a refusal module instead of
trust and refuses to open collections in any environment.

This branch pins `vendor/sdk-dev-66b24935.tgz`: a normal, source-only build of
mdbase-next `66b24935`. It has no packaged trust or native runtime, so the
production build refuses it. It is the candidate source that the SDK release
pipeline will package.

### The one input: `vendor/production-trust.pin.json`

The production build reads only this file. It is committed with every value
`null`, so `pnpm build` fails with a reason such as
`trustAssetSha256 is not set`. To enable a production build, fill in:

| Field              | Value                                                                          | Source                       |
| ------------------ | ------------------------------------------------------------------------------ | ---------------------------- |
| `trustAssetSha256` | SHA-256 (lowercase hex) of the published `next-trust/production.json` bytes    | Production trust publication |
| `logOrigin`        | Exact HTTPS origin of the production log, as recorded in that asset            | Production trust publication |
| `sdkPin`           | File name of the JSON pin for the production-packaged SDK archive in `vendor/` | SDK release                  |

`environment` and `cpOrigin` (`https://connect.mdbase.dev`) are fixed.

The preflight (`scripts/production-sdk.mjs`) then checks, without running the
SDK's origin-bound selector from Node:

1. `package.json` depends on exactly the archive named by `sdkPin`, and the
   archive's SHA-256 matches that pin.
2. The installed SDK's generated `dist/application/packaged-trust.js` is the
   canonical generated module, not the refusal module, and records
   `environment: production`, the production control plane, the pinned log
   origin and the pinned trust digest.
3. `dist/native/provenance.json` records the same values, with no verifier
   clock override.
4. `dist/native/runtime.wasm`, `sqlite3.wasm` and `sqlite3.js` match the SDK's
   committed asset pins.

Any missing, LAB or mismatched value fails the build. There is no environment
variable override. Never patch generated trust in this app.

### Pull-request CI

Pull requests to `main` run `pnpm verify:candidate` on the iOS and Android
workflows. That runs every check in `pnpm verify` and then
`pnpm build:candidate`, which builds the production-configured bundle even
when the trust input is absent so the native projects can be compiled. It
writes `dist/tasknotes-candidate.json` with `"releasable": false`. Release,
submission and deploy workflows keep `pnpm verify` / `pnpm build`, and a
release-script test checks that they never use the candidate build.

The 1.0.8 Swift proof-scoped request bridge and loggingBehavior: "none" are
retained; this bridge is not a replacement for the next SDK's Worker transport.

## Native sign-in

The SDK sign-in opener uses Capacitor Browser and the manifest-declared
dev.tasknotes.app://auth/mdbase/callback. Warm and cold URL returns wake the
original SDK owner and dismiss the browser. URL codes do not authorize access;
the SDK finishes through its authenticated pairing poll. The existing iOS URL
scheme and Android intent filter are retained.

## Migration waiting state

The SDK's server-classified collection_migrating outcome gets friendly waiting
copy and a read-only Retry. A live ready workspace remains mounted to protect
drafts. Generic local fences, denial, account suspension and recovery problems
must not be mislabeled as an account upgrade.

A collection that is still held by an older desktop app now gets the SDK's
typed `collection_not_yet_migrated` outcome. The shared collection screen shows
the SDK's copy ("Your collection needs an upgrade… open the latest mdbase
desktop app"), not "Can't connect". It is not treated as the self-resolving
upgrade wait, because waiting never fixes it.

**Remaining protocol dependency:** an account that has not been moved at all
still has no distinct typed outcome; the sign-in window refuses it and the
SDK reports a generic sign-in refusal. This needs a typed account outcome
from the control plane and SDK before the app can explain it. Do not infer it
from an empty collection list, generic fencing, error text or URL parameters.

## Validation (2026-10-18, release candidate)

- SDK intake `66b24935`: SDK typecheck and build pass; 2,058 SDK unit tests
  pass. The wasm integration file and the verifier-backed packaging tests
  need Rust-built artifacts and were not run for this intake.
- `pnpm verify:candidate` (remote): release scripts 69 pass, 1 skipped;
  format, typecheck and lint pass; 1,733 unit tests in 226 files pass;
  coverage and layer thresholds pass; conformance 4,982 pass, 1 skipped;
  the production-configured candidate bundle builds and excludes test
  fixtures.
- `pnpm build` refuses with
  `vendor/production-trust.pin.json trustAssetSha256 is not set`, as intended.
- GitHub Actions on the draft pull request: iOS (verify, `cap sync ios`,
  unsigned simulator `xcodebuild`) and Android (verify, debug APK) pass.
- Browser checks against the built preview: fixture pages are now built in
  e2e mode, which fixed 15 of 21 failures inherited from the base branch.
  Six remain: two accessibility specs and one cloud-connection spec still
  expect the old "Open TaskNotes" screen for a build with no selected
  environment (the next-only app now refuses to start without one); two
  controls-spacing specs cannot find the Recurrence button in the view
  editor; and one keyboard focus-restoration spec (already known). None
  affects the production build, but `deploy-pages` runs the same suite, so
  they must be fixed or updated before the web deploy.
- No live LAB, staging or production calls; no signing, upload or submission.

## Validation (2026-10-17)

- Remote typecheck passes; full unit suite: 1,730 tests in 226 files pass.
- Release scripts: 65 pass, one intentionally skipped.
- Remote e2e-mode bundle builds. Production build stops at the explicit SDK
  preflight, as required while production trust/assets are missing.
- Local Playwright (desktop and mobile): migration waiting/retry/return-to-gate,
  real public constructor and daily-experience suites: 17 pass, three
  platform-specific skips. All non-loopback traffic is blocked.
- A wider keyboard-shortcuts run additionally found two focus-restoration
  failures (one per platform) after task completion. Those are unresolved;
  this is not a claim that the entire browser suite passes.
- No live LAB, staging, production, signing, TestFlight or App Store actions.

## Ordered steps to App Store submission

Physical-device and TestFlight validation are skipped by decision (no device
available); simulator and CI evidence stand in for them. Steps marked
**[confirm]** need the maintainer's explicit confirmation for that action.

| #   | Step                                                                                                                                                                                                                                                        | Needs                                                                                                       | Owner                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | Approve and publish the production trust asset `next-trust/production.json`.                                                                                                                                                                                | Production approval; signed inventories/proofs and verifier context from the production `verify-trust` run. | Maintainer + release                      |
| 2   | Cut the production SDK release from mdbase-next main (≥ `66b24935`) with `MDBASE_SDK_APPLICATION_INPUTS` set to the step 1 outputs.                                                                                                                         | Step 1; qualified `mdbn-trust` verifier build and build receipt; native runtime pin.                        | SDK release                               |
| 3   | Vendor the production-packaged SDK archive and its JSON pin, point `package.json` at it, update the lockfile.                                                                                                                                               | Step 2 archive, SHA-256 and SRI.                                                                            | TaskNotes                                 |
| 4   | Fill `vendor/production-trust.pin.json` (`trustAssetSha256`, `logOrigin`, `sdkPin`).                                                                                                                                                                        | Step 1 digest and log origin; step 3 pin name.                                                              | TaskNotes, values confirmed by maintainer |
| 5   | Run `pnpm verify` (full, fail-closed). Production build must pass the preflight.                                                                                                                                                                            | Steps 3–4.                                                                                                  | TaskNotes                                 |
| 6   | Qualify the packaged SDK in a same-origin browser context: web production bundle served as `https://app.tasknotes.dev` and the iOS simulator build at `capacitor://app.tasknotes.dev`, both selecting production assets without errors.                     | Step 5; iOS simulator on the macOS runner or a Mac.                                                         | TaskNotes                                 |
| 7   | Simulator acceptance against production after the account move: cold launch, sign-in and return (warm and cold), cancel, renew, open the review collection, edit offline and sync, migration wait copy.                                                     | Step 6; review account (step 8).                                                                            | TaskNotes                                 |
| 8   | Create the App Review account: an mdbase account already moved to the new service, with a sample TaskNotes collection containing representative tasks. Enter its credentials and collection name in App Store Connect's sign-in information (never in Git). | Production account after the move.                                                                          | Maintainer                                |
| 9   | Confirm export compliance. `ITSAppUsesNonExemptEncryption` is currently `false`, but this version encrypts collection data end to end. Decide the correct declaration and update `Info.plist` or App Store Connect.                                         | Legal/export judgement.                                                                                     | Maintainer                                |
| 10  | Confirm version `1.0.9` and that the build number will exceed live 1.0.8 build 25 (the iOS release run number is used).                                                                                                                                     | —                                                                                                           | TaskNotes                                 |
| 11  | Approve `docs/releases/ios/1.0.9.json`: review the What's New and review notes, then remove the `draft` field. Keep `releaseType: MANUAL` so approval does not release before the migration window ends.                                                    | Steps 7–8.                                                                                                  | Maintainer                                |
| 12  | Merge the release branch to `main`. **[confirm]**                                                                                                                                                                                                           | Steps 1–11; release GO.                                                                                     | Maintainer                                |
| 13  | Run **iOS release** on `main` without upload, to produce a signed IPA. **[confirm]** (uses signing secrets)                                                                                                                                                 | Step 12.                                                                                                    | Maintainer                                |
| 14  | Run **iOS release** on `main` with upload, to send the build to App Store Connect. **[confirm]**                                                                                                                                                            | Step 13.                                                                                                    | Maintainer                                |
| 15  | Submit for review via **App Store submission** (preflight with `submit=false`, then `submit=true`) and approve the `app-store-production` environment. **[confirm]**                                                                                        | Step 14.                                                                                                    | Maintainer                                |
| 16  | After Apple approves, release the held version in App Store Connect at the end of the migration window. **[confirm]**                                                                                                                                       | Window end; approved build.                                                                                 | Maintainer                                |
| 17  | Deploy the web build with the same SDK and trust pin at window end via **Deploy Pages** (production target). **[confirm]**                                                                                                                                  | Step 12; window end.                                                                                        | Maintainer                                |

Open dependencies that affect wording or behaviour but not the build:

- An account that has not been moved yet still gets a generic sign-in refusal;
  the typed account outcome is pending in the control plane and SDK.
- The window date, and what users on rolled-back accounts should do, are not
  yet decided; both affect the review notes only if they change before
  submission.

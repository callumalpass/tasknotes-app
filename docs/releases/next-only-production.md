# Next-only production candidate — blocked, not approved for release

This candidate merges the 1.0.7/1.0.8 release fixes and draft-preserving update
reload into the next-only app. It does not implement a dual-backend fallback.
The version remains 1.0.9. Callum has confirmed next-only clients and one bounded production migration
window, with the app released at its end. Do not merge or submit without the
explicit release GO and the gates below.

## Production build and trust placeholder

`pnpm build` runs an offline production SDK preflight before building. It then
sets `VITE_TASKNOTES_ENVIRONMENT=production` and
`VITE_TASKNOTES_EDITOR_ORIGIN=https://editor.mdbase.dev`.
Web runs at exactly https://app.tasknotes.dev; native iOS runs at exactly
capacitor://app.tasknotes.dev, including WebKit's opaque-origin representation.
The manifest's publisher origin remains HTTPS; the declaration identifies the
actual native host. LAB origins are never a production fallback.

**Required from Callum:** the production trust asset, authenticated by the
normal SDK release pipeline, and the corresponding production-qualified SDK
artifact. The explicit placeholder is `vendor/production-sdk.required.json`;
it contains no key, pins, or made-up runtime. Update the SDK tarball and lockfile
through the normal intake process, then replace the pinned-SDK blocker test
with production artifact qualification. Never patch generated trust in this app.

The pinned SDK 4fb345e4 packages LAB trust only. Its
`application/packaged-assets.js` explicitly rejects production. Its
`scripts/build-application-assets.mjs` also supports only authenticated LAB
inputs. A production trust file alone is therefore **not sufficient**: the SDK
release pipeline and asset selector need production support. The preflight
checks both web and iOS selections and fails before a misleading build ships.
No signed native build or successful production login is claimed.

The obsolete, unreferenced app-owned LAB native-build loader has been removed:
web and native both use the canonical SDK-owned packaged runtime/Worker/SQL path.
The 1.0.8 Swift proof-scoped request bridge and loggingBehavior: "none" are
retained; this bridge is not a replacement for the next SDK's Worker transport.
Actual next-runtime request origin behavior still needs a TestFlight device check.

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

**Remaining protocol dependency:** the current public SDK has no authenticated
account-backend facade or distinct legacy-account outcome. An account that is
not yet migrated must be surfaced by the SDK/CP as the same typed migration
outcome (including a migration fence), or a new documented account-upgrade
outcome, before we can honestly show this screen for legacy accounts. Do not
infer migration from an empty collection list, generic fencing, arbitrary error
messages, URL parameters or a second legacy login client.

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

## Release gates

- Supply and qualify the production SDK/trust artifact; rebuild web and native.
- Agree the legacy-account and migration-fence SDK/CP outcome; qualify both.
- Provide an App Store review account already migrated, with a sample collection.
- TestFlight on a physical iPhone: cold launch, warm/cold sign-in return, cancel,
  renew, hosted/private collection requests, pending-edit preservation and upgrades.
- Verify account migration waiting/retry against an isolated approved environment.
- Reconfirm 1.0.9 metadata and build number above live 1.0.8 build 25.
- Obtain Callum's explicit cutover GO. No deploy, signing, submission or merge
  is authorized by this candidate.

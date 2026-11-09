# iOS release

TaskNotes uses the App Store Connect record with SKU `tasknotes-ios` and bundle
ID `dev.tasknotes.app`. Ops App CD builds the exact qualified main source,
uploads its signed IPA to TestFlight, waits for Apple processing, and submits
with automatic release on approval. A TestFlight upload alone does not mean the
app is public. See [store automation](mobile-store-automation.md).

## Apple configuration

The existing identities are already configured. Any certificate, signing-identity
or trust-key change requires Callum's approval with the reason; these setup
instructions do not authorize a rotation.

In Certificates, Identifiers & Profiles:

1. Keep Push Notifications enabled on the explicit `dev.tasknotes.app` App ID.
2. Create an **Apple Distribution** certificate and export the certificate and
   its private key together as a password-protected PKCS#12 (`.p12`) file.
3. Create an **App Store Connect** distribution provisioning profile for
   `dev.tasknotes.app`, select that distribution certificate, and download the
   `.mobileprovision` file.

In App Store Connect, use **Users and Access → Integrations → Team Keys** to
create a Developer-role API key for CI uploads. The Account Holder may need to
request API access first. Use a team key: command-line build uploads do not
support individual API keys. Download the `.p8` private key immediately and
record its Key ID and Issuer ID. Apple permits the private key to be downloaded
only once.

## Firebase configuration

Add the iOS application `dev.tasknotes.app` to the production Firebase project.
Download `GoogleService-Info.plist`. Enable Push Notifications on the Apple App
ID, create an APNs authentication key, and upload that APNs key directly to
Firebase under **Project settings → Cloud Messaging**.

The Firebase plist, APNs key, App Store Connect key, distribution certificate,
and certificate private key must never be committed to Git.

## GitHub configuration

Configure these repository variables:

- `APPLE_TEAM_ID`: the ten-character Apple Developer Team ID.
- `APP_STORE_CONNECT_ISSUER_ID`: the App Store Connect team API Issuer ID.
- `APP_STORE_CONNECT_KEY_ID`: the App Store Connect team API Key ID.
- `TASKNOTES_FIREBASE_PROJECT_ID`: the production Firebase project ID.

Configure these repository secrets:

- `APPLE_DISTRIBUTION_CERTIFICATE_BASE64`: base64-encoded `.p12` file.
- `APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD`: password used when exporting the
  `.p12` file.
- `APPLE_PROVISIONING_PROFILE_BASE64`: base64-encoded `.mobileprovision` file.
- `APP_STORE_CONNECT_PRIVATE_KEY_BASE64`: base64-encoded team API `.p8` file.
- `GOOGLE_SERVICE_INFO_PLIST_BASE64`: base64-encoded
  `GoogleService-Info.plist` file.

Keep base64 values on one line. On this Linux development machine, encode a
file without writing an extra copy using:

```sh
base64 -w 0 path/to/private-file
```

Paste the result directly into the matching GitHub Actions secret. Do not paste
private values into an issue, pull request, commit, or chat.

## Build, submit and release

Ops dispatches `publish-tasknotes-store.yml` for the `app-store` target.
`ios-release.yml` receives exact `source_sha` and an allocated numeric `version`;
there is no tag path, optional upload, manual submission or manual-release input.
Main ancestry, exact CI, SDK/trust and app/target stops are checked before
candidate dependencies execute. The existing distribution identity, temporary
keychain, provisioning profile, Firebase archive check and cleanup are retained.
The Xcode runner still requires the iOS 26 SDK or newer.

The iOS release run number is the build number. The protected source receipt and
signed artifact bind it to the selected source and marketing version. Public
submission verifies the successful exact TestFlight upload, waits for the exact
processed store-eligible build, and preserves all existing metadata, inherited
contacts, screenshots, encryption and optional demo-account readback checks.

The production environment stays `app-store-production`, with the existing
`APP_STORE_PUBLISH_KEY_ID`, `APP_STORE_PUBLISH_ISSUER_ID` and
`APP_STORE_PUBLISH_PRIVATE_KEY_BASE64` credential. Optional review credentials
remain available only to the submission step. Main-only admission must not
require a separate person to approve deployment. The submission always uses
`AFTER_APPROVAL`, never phased or manual release. Review pending is a quiet wait;
a rejected review or failed build/upload stops only `tasknotes-app-store`.

Validate generated metadata without calling Apple with
`TASKNOTES_IOS_VERSION=1.0.13 node scripts/submit-app-store.mjs --validate`.
No physical device or manual GO packet is required by orchestration. Genuine
Apple account/legal actions and review rejection remediation remain external
requirements, not a reason to weaken signing or trust checks.

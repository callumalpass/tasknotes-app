# iOS release

TaskNotes uses the App Store Connect record with SKU `tasknotes-ios` and bundle
ID `dev.tasknotes.app`. A manually triggered GitHub Actions workflow builds a
signed IPA and can upload it to TestFlight without a locally owned Mac or iOS
device. Public App Store submission is a separate, explicitly approved step;
a successful TestFlight upload alone does **not** update the public store.

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

## Build and upload

Run **iOS release** from GitHub Actions. Leave the marketing version blank to
use the application version from `package.json`. Enter a version only when the
iOS release intentionally needs to override that shared version.

- Leave **Upload the signed build to TestFlight** disabled for the first run.
  The workflow verifies the web application, restores the Firebase plugin,
  signs and archives the native app, exports an IPA, and retains it as a
  private workflow artifact.
- After that run succeeds, run it again with upload enabled. The GitHub Actions
  run number becomes the App Store build number, so every run remains unique.

An `ios-v<version>` tag also builds and uploads automatically. Prefer manual
dispatch for the first release so the upload remains deliberate.

The workflow requires Xcode with the iOS 26 SDK or newer and stops before
building if the selected runner image does not meet Apple's current upload
requirement. Signing material is installed into a temporary keychain and
removed after the job. Before export, the workflow also verifies that the
Firebase configuration is present in the archived app and belongs to
`dev.tasknotes.app`; a Firebase-enabled archive cannot be uploaded without it.
GitHub-hosted runners are discarded after the job.

## Public App Store releases

The current queue, common source/CI/SDK/wasm gates, 24-hour gap, per-store stops
and deployment hold are in [mobile store automation](mobile-store-automation.md).
The old `submit_public` input and combined build/submit job have been removed.
`ios-release.yml` builds and optionally uploads to TestFlight only.

The existing `app-store-production` environment admits only main and holds:

- `APP_STORE_PUBLISH_KEY_ID` and `APP_STORE_PUBLISH_ISSUER_ID` variables;
- `APP_STORE_PUBLISH_PRIVATE_KEY_BASE64` publishing secret;
- the existing optional `APP_REVIEW_DEMO_ACCOUNT_NAME` and
  `APP_REVIEW_DEMO_ACCOUNT_PASSWORD` secrets.

Preserve these credentials; do not elevate/replace the upload key or signing
identity. Routine submissions use automated gates, not a newly added
per-release human environment review. The initial production hold still needs
Callum's exact-plan go before enabling the queue.

### Build, qualify and submit

1. Use a new numeric source package version through a normal main PR if the
   existing version is already live. Version overrides can still build/upload,
   but automated public submission requires the source package version.
2. Build/upload to TestFlight with `ios-release.yml`. A successful upload is
   not proof of native wasm qualification or public release.
3. The native harness must exercise the exact signed artifact and retain the
   digest-bound wasm proof described in the automation contract. Its proof
   producer is not implemented yet; do not synthesize a passing artifact.
4. The queue plans the newest qualified green main source. Only after the
   initial hold is cleared with go may it dispatch `app-store-submit.yml`.
   The publisher rechecks the same source gates and active review state.
5. Existing listing/screenshots and review contacts are inherited/verified.
   Explicit version notes are used when available; otherwise neutral
   locale-complete notes and reviewed sign-in instructions are generated.
   No credentials or legal/compliance answers are invented.

The standalone publisher accepts the successful **iOS release workflow run ID**,
not its build number, and does not rebuild or re-upload the IPA. Its
`submit=false, release=false` mode is read-only. Real submission/release modes
have the common guard even when directly dispatched; they are not bypasses.

Unknown writes must be reconciled, not rerun. The script refuses to replace a
different attached build, cancel another review, submit unrelated draft items
or proceed with missing compliance answers or an ineligible build. Rejection
stops only `tasknotes-app-store`; agents inspect App Review privately, repair or
resubmit through CI, reconcile and clear that line. Routine rejection is not an
owner escalation.

`WAITING_FOR_REVIEW` means submitted, not live. Default updates release after
Apple approval; reviewed MANUAL versions still use the same guarded release
mode. Initial legal/account agreements, app privacy, age ratings and
export-compliance declarations require truthful account-holder answers and are
not fabricated by automation. Apple's approval timing remains Apple's decision.

`store-status.yml` reports the latest live version separately from the source
package version, using bounded dashboard JSON artifacts. See the automation
contract for artifact names, schema and freshness rules.

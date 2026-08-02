# iOS release

TaskNotes uses the App Store Connect record with SKU `tasknotes-ios` and bundle
ID `dev.tasknotes.app`. A manually triggered GitHub Actions workflow builds a
signed IPA and can upload it to TestFlight without a locally owned Mac or iOS
device.

## Apple configuration

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

Run **iOS release** from GitHub Actions. Enter an App Store marketing version,
such as `1.0.0`.

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
removed after the job. GitHub-hosted runners are discarded after the job.

# iOS release

TaskNotes uses the App Store Connect record with SKU `tasknotes-ios` and bundle
ID `dev.tasknotes.app`. A manually triggered GitHub Actions workflow builds a
signed IPA and can upload it to TestFlight without a locally owned Mac or iOS
device. Public App Store submission is a separate, explicitly approved step;
a successful TestFlight upload alone does **not** update the public store.

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

### One-time configuration

The `app-store-production` GitHub environment holds the separate publishing
credential. Keep the existing Developer-role upload key at repository scope;
**do not elevate or replace it** just to enable public releases.

Configure this environment with:

- Required reviewer: `callumalpass`. Self-review is allowed so the sole maintainer
  can approve a manually dispatched run.
- Deployment branch policy: **selected branches**, with only the `main` branch
  allowed (not tags).
- Variable `APP_STORE_PUBLISH_KEY_ID`: an App Store Connect **team key** with
  **App Manager** access.
- Variable `APP_STORE_PUBLISH_ISSUER_ID`: that team's issuer ID.
- Secret `APP_STORE_PUBLISH_PRIVATE_KEY_BASE64`: base64 of its `.p8` private key.

These are configured for this repository using the existing **TaskNotes
Publishing** key. The secret is environment-scoped and is only available after
approval. App Store team keys apply to all apps on the team, so keep this key
out of ordinary build jobs and fork/PR workflows. Initial listing setup, legal
agreements, app privacy, age ratings and export-compliance declarations remain
manual responsibilities. The script never invents or changes those answers.

### Build and submit a new release

1. Update `package.json` as usual and commit
   `docs/releases/ios/<version>.json`, using `1.0.3.json` as the format example.
   Set the exact numeric `version`, current `copyright`, `whatsNew` for **every
   existing store locale**, and accurate `reviewNotes`. Keep login credentials
   out of Git; review contacts and any credentials already in App Store Connect
   are inherited. Update screenshots in App Store Connect if the old ones no
   longer accurately represent the app.
2. Merge the changes to `main`.
3. Run **iOS release** on `main` with both **Upload** and **Submit public** enabled.
4. Once the build succeeds, approve the `app-store-production` deployment in
   GitHub Actions. Check the source commit, version and release notes first.

The public job waits up to 30 minutes for the **exact version and build number**
to finish processing. It creates/reuses the store version, preserves the
inherited listing/screenshots, updates release/review notes, attaches the build,
and submits it for App Review. Release is automatic after Apple approval, for
all users immediately (no phased rollout). Tags and ordinary uploads remain
**TestFlight-only**; `submit_public` defaults to false.

```sh
gh workflow run ios-release.yml --ref main \
  -f version=1.0.4 -f upload=true -f submit_public=true
```

### Promote an existing upload or recover a failed submission

Use **App Store submission** on `main` with the **iOS release workflow run ID**
(not its build number). It verifies the source workflow succeeded, the source
commit is an ancestor of the approved policy commit, and its unexpired artifact
identifies exactly one version/build. The release notes come from the approved
`main` commit, so this can also promote older uploads that predate the metadata
file. It does not rebuild or re-upload the IPA.

```sh
# Read-only preflight (still requires environment approval to use the key):
gh workflow run app-store-submit.yml --ref main \
  -f source_run_id=34902463733 -f submit=false

# Deliberate public submission of that exact build:
gh workflow run app-store-submit.yml --ref main \
  -f source_run_id=34902463733 -f submit=true
```

For an interrupted combined run, **rerun failed jobs only**, not the successful
build job: Apple will reject re-uploading an existing build number. Alternatively,
use the promotion workflow above. Partial listing/submission setup is reconciled
on rerun; an already submitted identical build is a read-only success. Writes
are not blindly retried after ambiguous network failures.

The script refuses to replace a different attached build, cancel another
release, submit unrelated draft review items, retain a phased rollout, or
proceed with missing translations, missing compliance answers or an ineligible
build. Resolve such conflicts in App Store Connect, then rerun deliberately.

### Verification and limits

The Actions summary reports the exact source and Apple's resulting state.
`WAITING_FOR_REVIEW` means **submitted, not live**. Verify `READY_FOR_SALE` and
Apple's public listing after approval; approval timing remains Apple's decision.

Local tests require only Node 22 or newer:

```sh
pnpm test:release
TASKNOTES_IOS_VERSION=1.0.3 node scripts/submit-app-store.mjs --validate
```

Running `submit-app-store.mjs` without `--submit` is read-only. API credentials
are still required outside `--validate`; never print them or commit them.

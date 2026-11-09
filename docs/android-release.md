# Android release

TaskNotes package `dev.tasknotes.app` ships through ops App CD. Protected main
builds a signed APK and AAB for the exact selected green source, then uploads the
AAB directly to Play production at 100% on review approval. See
[store automation](mobile-store-automation.md) for the shared contract and stops.
There is no tag-triggered, alpha-promotion or GitHub-release handoff.

## Store prerequisites

Keep Play App Signing, the existing registered upload key and the existing
TaskNotes-scoped Android Publisher service account. Complete the listing,
privacy, policy and app-access forms, and any Google-enforced production-access
qualification before enrollment. Managed publishing must be off for automatic
publication on approval. Do not create keys or change signing identity as part
of a normal deployment.

## Upload signing key

Create one upload key and preserve it in a durable private backup. Register its
public certificate with Play App Signing. Losing the upload key requires a Play
Console reset procedure; GitHub secrets cannot be read back as a backup.

Configure these repository secrets:

- `ANDROID_KEYSTORE_BASE64`: base64-encoded upload keystore;
- `ANDROID_KEYSTORE_PASSWORD`;
- `ANDROID_KEY_ALIAS`;
- `ANDROID_KEY_PASSWORD`;
- `GOOGLE_SERVICES_JSON_BASE64`: production Firebase Android configuration.

The main-source workflow rejects missing signing values rather than publishing an
unsigned bundle.

## Production credential and versioning

Use the existing main-only `google-play-production` environment and
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64` secret. No environment reviewer or
submission toggle is part of this policy. Preserve least-privilege app view and
production-release access; no finance or account-administration grant is needed.

`scripts/publish-google-play.mjs` has one fixed public target: production,
`completed`, exactly one uploaded AAB version, with no fraction. It validates
before committing and preserves the store's review-in-flight race guard.
The fixed `TASKNOTES_ANDROID_VERSION_CODE_BASE` plus Android run number must
exceed every existing store artifact code. Marketing versions are allocated by
the coordinator, not tags. The APK/AAB remain private retained build artifacts.

The uploader verifies the exact Actions artifact archive digest and expected
APK/AAB inventory before upload. A failure stops only `tasknotes-google-play`.
Do not rerun or manually retry an unknown publication; reconcile its exact run
and store state through the ops front door first. A committed release cannot be
rolled back to an older version code; a correction needs a newer build.

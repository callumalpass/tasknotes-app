# Android release

TaskNotes uses package ID `dev.tasknotes.app`. Tagged Android releases build a
signed APK and Android App Bundle, publish the bundle to Google Play's `alpha`
closed-testing track, and then create a GitHub release. Production is a
separate, manually dispatched and reviewer-protected step that promotes a
version code already on `alpha`; tags never publish to production.

## One-time Play Console setup

1. Create TaskNotes in Play Console and use Play App Signing.
2. Enable the Google Play Android Developer API in a dedicated Google Cloud
   project.
3. Invite a dedicated service account to TaskNotes only. Grant view access and
   permission to release to testing tracks and to production. Add tester-list
   management only if it is separately needed; the publication workflows do
   not require it. Do not grant store-presence, finance, account
   administration, or user-management permissions.
4. Associate the `alpha` closed-testing track with a stable Google Group or
   tester email list and publish its opt-in link.
5. Complete the required store listing, policy, privacy, and app-access forms.

For personal developer accounts subject to Google's production-access gate,
recruit more than the minimum number of testers so attrition does not interrupt
the required continuous opt-in period. Internal testing does not satisfy that
gate.

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

The tag workflow rejects missing signing values rather than publishing an
unsigned bundle.

## Play API credential

Create the GitHub environment `google-play-closed-testing`. Its deployment ref
is protected `main` because the credential-bearing workflow is intentionally
loaded from the default branch after the tag workflow completes. Restrict the
environment to `main`, protect creation of `android-v*` tags separately, and
store the base64-encoded service account JSON as the environment secret
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`.

The repository-owned `scripts/publish-google-play.mjs` exchanges the credential
for a short-lived token scoped only to Android Publisher. Its policy is fixed in
code:

- package: `dev.tasknotes.app`;
- track: `alpha` (closed testing);
- release status: `completed`;
- exactly one uploaded AAB version;
- validate the edit before committing it.

The script has no track override. Production promotion is a separate mode,
described below, selected only by the `--promote-production` flag that the
production workflow passes.

## Publish a closed-test build

1. Set `package.json` to the intended version and merge the verified commit to
   `main`.
2. Tag that exact commit using `android-v<version>`, where `<version>` exactly
   matches `package.json`, for example:

   ```bash
   git tag -a android-v1.0.1 -m "TaskNotes Android 1.0.1"
   git push origin android-v1.0.1
   ```

3. Monitor the **Android** workflow. It verifies the app and builds signed
   APK/AAB artifacts. After that succeeds, **Google Play closed testing** runs
   trusted publication policy from protected `main`, verifies that the tag's
   commit belongs to `main`, publishes the AAB to `alpha`, and reconciles the
   GitHub release only after Play accepts the edit.
4. In Play Console, confirm the version appears on the closed-testing track and
   install or update through the tester opt-in link.

The workflow computes a stable `versionCode` as
`TASKNOTES_ANDROID_VERSION_CODE_BASE + Android workflow run number`. Configure
`TASKNOTES_ANDROID_VERSION_CODE_BASE` once as a repository variable so the first
result exceeds every code already committed in Play. Do not change it after
publication. Rerunning the same source workflow reuses the same code; the
publisher treats the exact existing closed-test state as success and rejects a
conflicting state.

A committed Play release cannot be rolled back to an older version code.
Publish a newer corrective build or halt the closed track in Play Console.

## Promote a closed-test build to production

A fresh read-only API snapshot on 2026-11-06 confirmed an existing completed
production release: TaskNotes 1.0.12, version code 100738. Production access is
not the same thing as review clearance for the next version.

The `google-play-production` environment already has the scoped
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64` secret and admits only `main`.
Preserve existing credentials and signing identities. Do not add per-release
human approval as a substitute for automated qualification.

Current production policy, queue, exact-build wasm evidence, isolated store
holds, dashboard artifacts and remaining API limits are documented in
[mobile store automation](mobile-store-automation.md). That document supersedes
the retired full-rollout/manual-promotion procedure:

- The queue selects the newest qualified green main source with a completed
  alpha build and enforces the SDK floor, exact signed-build wasm proof,
  independent Play hold and 24-hour gap again at the production boundary.
- Promotion starts at `inProgress` with `userFraction: 0.1`; previous completed
  releases are preserved. There is no full-rollout fallback.
- Scheduled boundary/Vitals checks halt the exact owned staged version on
  failure and stop only `tasknotes-google-play`. Guarded 24-hour stages widen
  10% → 50% → 100%; missing Vitals never authorizes widening.
- Android Publisher release summaries expose review/rejection lifecycle on
  every track. Unknown observations fail closed. Commits use the atomic
  `ERROR_IF_IN_REVIEW` guard, never the review-cancelling API default.
- The enable variable remains unset; neither this wiring nor a successful
  status read authorizes a production submission.

Do not dispatch a production promotion until the exact plan has been presented,
the signed build's wasm route has passed, and Callum has said go. The existing
`google-play-production.yml` is still the only production publisher; the queue
uses that same guarded path. Never rerun an unknown store mutation or manipulate
Server CD to recover a Play release.

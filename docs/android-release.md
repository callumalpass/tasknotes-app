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

TaskNotes has Play production access. Production releases are never triggered
by tags: a build first goes through the closed-testing flow above, and only
then is promoted on demand.

### One-time production environment setup

A repository administrator creates the GitHub environment
`google-play-production`:

1. **Required reviewers:** `callumalpass`. Leave "Prevent self-review" off,
   because the same maintainer dispatches and approves the run, and disable
   administrator bypass if the plan offers it.
2. **Deployment branches and tags:** selected branches only, with the single
   rule `main`.
3. **Environment secret:** `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`, holding
   the same base64-encoded service-account JSON as the
   `google-play-closed-testing` environment. GitHub cannot copy secrets between
   environments; set it again from the durable private copy of the key file,
   for example
   `base64 -w0 service-account.json | gh secret set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64 --env google-play-production`.

The service account must have permission to release to production in Play
Console (see the one-time Play Console setup above).

### Production policy

`scripts/publish-google-play.mjs --promote-production <versionCode> <version>`
uses a fixed policy:

- package: `dev.tasknotes.app`;
- track: `production`;
- release status: `completed` (full rollout, no `userFraction`);
- no upload: the version code must already be a completed `alpha` release
  named `TaskNotes <version>`; its release notes are copied unchanged;
- refuses if production has any release that is not `completed` (for example
  a staged rollout or halted release started in Play Console), or already
  contains this or a higher version code in a different state;
- the exact existing production state is a read-only success, so reruns are
  safe;
- validates the edit before committing it.

A full rollout is deliberate: the identical bundle has already run on the
closed track, the install base is small, and a staged rollout would leave an
`inProgress` release requiring manual follow-up before the next promotion. To
halt a bad production release, use Play Console and publish a newer
corrective build through closed testing and promotion.

### Dispatch a production promotion

1. Confirm the version is on the `alpha` track and has been tested.
2. Dispatch the workflow from `main`:

   ```bash
   gh workflow run google-play-production.yml --ref main \
     -f release_tag=android-v1.0.10
   ```

3. The **Google Play production** workflow verifies the tag commit is
   reachable from `main` and matches `package.json`, and derives the version
   code from the tag's successful **Android** run exactly as closed testing
   did. It then waits for approval on the `google-play-production`
   environment.
4. Approve the deployment in the Actions run. The publisher checks that the
   version code is on `alpha`, promotes it, and commits after Play validates
   the edit. Production releases then go through Google Play review before
   they reach the store.

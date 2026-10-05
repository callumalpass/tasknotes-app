# Temporary dual-backend release

Status: development; the application still uses its existing Connect path.
No dual-backend store candidate has been built or submitted.

## Agreed boundaries

- Control owns an explicit persisted per-account `backend: "legacy" | "next"`,
  defaulting to `legacy`. Its account endpoint is `GET /v1/account`.
- Grant-only apps use the proposed authenticated `GET /v1/account/backend` response
  `{account_id, backend}`. It binds to the consenting account, not the collection
  creator or connector. The Connect SDK owns the retained-grant credential and
  client proof; TaskNotes never obtains a raw token or signer. Implementation and
  an exact Connect artifact pin are pending.
- Unknown/missing backend values fail closed. Authentication, reachability,
  target kind and errors never select another backend.
- Legacy accounts continue through the existing application session and
  `MdbaseTaskRepository`. Next accounts use a native `TaskRepository` over the
  next SDK's `MdbaseClient`; there is no old-operation translation layer.
- Cloud-copy and private accounts use the same authorized `/next` route/openPipe
  bridge. Cloud copy can be served while user devices are off; private
  collections require an authorized user device online. There is no conversion
  or hosted fallback when a private device is unavailable.
- Next reminders use the v2 SDK wrapper of the existing control-plane HTTP timer
  and push-channel APIs, independently of the data connection. Dropped reminders
  during cutover are acceptable. Do not call legacy collection timer operations
  on a next grant.

## Lifecycle and uncertain writes

Backend detection must precede any data/setup request. The existing Connect
application session performs collection setup checks before reaching `ready`,
so merely replacing its repository after `ready` is insufficient. The app
needs a retained-consent connection before choosing legacy or native-next
readiness; the same X25519 client key must be registered before next consent
and retained across web/native callbacks.

A backend change quiesces the old collection instance before opening the new
one. Existing pending/unknown changes retain their original backend, request
identity, input and outcome. They must be reviewed/reconciled there, never
reissued as fresh next mutations. Cancellation and a lost response do not
prove that a write did not apply. Confirmation, not optimistic SDK records,
is the application's successful-save boundary.

The app does not persist a task replica or collection keys. Cache and grant
lifetimes are bounded by the selected account/collection instance. Native
configuration, views, Scratchpad, completions and files must use the replica's
actual supported methods; task/type/query semantics remain in mdbase.

## Qualification and removal

The current vendored next SDK is a dormant development snapshot, not an approved
store dependency. Unit tests cover strict backend selection and native record
projection; they do not establish actual account detection, ordinary consent,
LAB routing, reminders or mobile readiness.

Before release, pin the actual app commit, qualified SDK and Connect artifacts,
and record LAB tests for legacy plus next cloud-copy/private, task CRUD and
confirmed read-back, view/settings/Scratchpad/file flows, reminders/cancel/revoke,
account changes and ambiguous in-flight writes. Add Playwright coverage to the
existing app suites once the runtime path is wired. Never use an admin fixture
or another app's grant as ordinary-account acceptance.

Bump the shared package version only for the completed candidate. Build iOS with
`upload=false, submit_public=false`; build Android with
`signed_candidate=true` and **no tag**. Record the exact workflow run, commit,
version and iOS build/Android versionCode in the coordinator outbox. Signing
material stays in the documented GitHub Actions process.

After Callum approves submission, use manual iOS release and Play Console Managed
publishing so review does not make the app live. See [iOS](ios-release.md) and
[Android](android-release.md). Do not submit, upload, publish or deploy production
without approval. Production web clients switch with the backend; mobile gets
this one dual release beforehand. Control's minimum-version check must refuse
stale clients after cutover and show an update prompt. Remove the temporary
legacy application path a few weeks after cutover, when the supported mobile
cohort has this release; migration/rollback retention is separate.

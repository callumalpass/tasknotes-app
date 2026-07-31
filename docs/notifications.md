# Notifications

TaskNotes delivers reminders only for mdbase hosted collections. Connected
reminders are stored as grant-scoped one-shot timers at the hosted provider and
delivered through standards-based Web Push or Connect-managed FCM. Local
Markdown and live connector collections retain portable reminder data but do
not schedule notifications.

TaskNotes does not subscribe to general collection-change notifications.
Connected timers continue running when the app and device are offline. The
installation keeps only its push registration and opt-in state; it does not
keep an OS schedule or reminder-ID registry for the connected collection. Task
and reminder IDs, descriptions, paths, and record content remain at the
collection authority. Pushes use fixed manifest text and act only as a wake-up
hint.

Connected delivery is available in the native Android and iOS apps and in
browsers that support standards-based Web Push. On iPhone and iPad, Web Push is
available only after TaskNotes has been added to the Home Screen. TaskNotes asks
for system permission only after the user selects **Turn on reminders**. A
received reminder refreshes current authorized state; it never embeds task
content in the notification.

The public application manifest subscribes only to the canonical Runtime 0.2
event contract `mdbase.runtime.timer.fired@1.0.0`. Its event data is validated
with JSON Schema before notification policy is evaluated; contract
compatibility does not grant notification access.

The PWA uses `MdbaseConnection.registerNotifications()` with the Connect VAPID
key and a module service worker. The worker validates the content-free mdbase
payload, shows the manifest-declared presentation, refreshes an open client,
and focuses or opens TaskNotes when the notification is selected. Browser push
does not use the TaskNotes Firebase project.

Android uses Capacitor's official `@capacitor/push-notifications` plugin, the
same native FCM path exercised by Pickle. iOS uses
`@capacitor-firebase/messaging` because Connect requires an FCM token and the
official Capacitor iOS plugin returns an APNs token. Keep those platform
adapters behind the shared notification manager.

The settings screen starts in an explicit **Checking** state. An unsupported or
insecure browser reports **Not available in this browser**. Do not use that
label as an initial placeholder: an unresolved permission or network promise
must remain visibly distinct from a capability check.

Native availability is determined from the packaged Capacitor plugin, not by a
runtime application-discovery request. The native plugin and the managed-FCM
manifest declaration are generated from the same Firebase build configuration.
Connect validates the declaration again when the device token is registered.
This keeps the permission control responsive and makes registration failures
visible to the user.

If an existing connection predates the notification criteria, TaskNotes shows
**Approval required** after the first enable attempt. Select **Review
notification access**, approve the updated application manifest in mdbase, and
then turn reminders on. Manifest updates never silently broaden an existing
collection grant.

## Firebase project setup

Use one Firebase project per environment.

1. Create a Firebase project and note its project ID.
2. Add an Android app with package name `dev.tasknotes.app`. Download
   `google-services.json` to `android/app/google-services.json`.
3. Add an iOS app with bundle ID `dev.tasknotes.app`. Download
   `GoogleService-Info.plist` to `ios/App/App/GoogleService-Info.plist` and add
   it to the App target in Xcode.
4. In Apple Developer, enable Push Notifications for the application
   identifier. Create an APNs authentication key and upload it directly to
   Firebase under Project settings → Cloud Messaging. Do not give the APNs key
   to mdbase Connect.
5. Set `TASKNOTES_FIREBASE_PROJECT_ID` whenever running `pnpm cap:sync`,
   building the native app, or building its public manifest. TaskNotes includes
   the native Firebase plugin only when this value and that platform's
   downloaded Firebase file are both present, so an unconfigured build remains
   safe to launch.

For GitHub Actions, set:

- repository variable `TASKNOTES_FIREBASE_PROJECT_ID`;
- repository secret `GOOGLE_SERVICES_JSON_BASE64`, containing the base64
  encoding of `google-services.json`.

The two downloaded Firebase files are intentionally ignored by Git. Local and
CI builds remain valid without them, but the manifest omits managed native
delivery and the settings screen reports that Firebase setup is required.

## Regression coverage

Unit tests cover browser/native distinction, Web Push registration and opt-out,
missing native configuration, permission flow, FCM token registration errors,
and a registration timeout.
The Android smoke test must cross the official plugin boundary, obtain a real
FCM token, send a content-free signal through FCM HTTP v1, and observe it in
the foreground. `TASKNOTES_ANDROID_SKIP_FCM_DELIVERY=1` may be used to
continue diagnosing unrelated smoke steps during a confirmed FCM outage, but
that run does not count as a push-delivery pass.

## Allow Connect to send

Connect sends through the FCM HTTP v1 API. Grant the Connect sender service
account only `cloudmessaging.messages.create` on the TaskNotes Firebase
project. A custom IAM role with that single permission is preferred over a
broad Firebase administrator role.

This grant lets Connect send notification text to TaskNotes installations; it
does not grant record access or expose the APNs key. It is nevertheless a
trusted-sender relationship. Revoke it if TaskNotes moves to its own
notification backend. Applications serving unrelated third-party developers
should normally use Connect's signed-webhook mode and keep Firebase/Apple
credentials in their own infrastructure.

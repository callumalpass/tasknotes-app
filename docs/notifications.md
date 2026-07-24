# Notifications

TaskNotes has two independent notification paths:

- task reminders are scheduled locally and never leave the device;
- mdbase change notifications are content-free wake-up signals evaluated by
  the mdbase Runtime and delivered through Connect-managed FCM.

Change notifications are available only for a connected mdbase collection in
the native Android or iOS app. TaskNotes asks for system permission only after
the user selects **Turn on change notifications**. A received notification
refreshes the offline replica; opening one returns to the task view. Titles and
bodies are fixed manifest text and never contain task names, paths, or record
content.

If an existing connection predates the notification criteria, TaskNotes shows
**Approval required** after the first enable attempt. Select **Review
notification access**, approve the updated application manifest in mdbase, and
then turn notifications on. Manifest updates never silently broaden an
existing collection grant.

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

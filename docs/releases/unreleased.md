# Unreleased

- Confirm a change whose result was interrupted automatically, instead of asking you to recover it. A new task shows that it is being confirmed and finishes by itself; only a definite failure is shown as an error. Keep the workspace open while the collection re-checks a change, so saves and view discovery are no longer interrupted.

- Keep Sign in available while waiting for approval, and show the SDK's retry guidance when sign-in is refused or expires. An explicit retry uses the original SDK sign-in owner.

- Show a one-time mdbase upgrade notice to returning users without blocking work or changing their stored collection data.
- Carry existing collection Home and ordered pinned-view choices into the account-scoped next app preferences. Existing next-mode choices take precedence, and full browser storage no longer interrupts restoring views.

- Show the shared SDK's connection guidance and collection upgrade status without clearing unsaved input from a usable workspace. Registration refusals keep technical manifest details in developer diagnostics only.
- Keep unavailable collection choices visible with the SDK's reason and suggested action when availability is reported, rather than offering an unusable Open action. Use the SDK's updated guidance and action labels for collection upgrades and access problems.

- Use consistent mdbase wording in person-record guidance and collection access help.

- Update the shared collection client and its packaged runtime used by the next-mode app, including collection setup assessment and exact declared native sign-in callback support.

- Offer an explicit reload when an app update activates, without automatically clearing unsaved input. Keep older cached assets available to tabs still running the previous build.

- Restore the supported iOS Capacitor URL scheme and align mobile version metadata above the previous app version. SDK mobile sign-in and device validation remain separate.

- Recognize SDK permission and write failures correctly, including the warning when a change may have been applied but its result could not be confirmed. Uncertain writes are not marked safe to retry.

- Restore image attachment controls and assignee selection in shared-SDK collections through the original SDK connection. File actions follow the current grant, and downloads verify the selected file's identity and current content revision. Assignees come from the selected collection's person records; saved links use the SDK's resolution.

- Use the shared mdbase sign-in owner and collection selection. Collection links retain their requested target until approval; cancelling the collection picker keeps the current workspace and route. Setup and reapproval stay explicit.

- Offer a clear Retry when the SDK can recover opening an approved collection after a temporary sign-in service failure. Uncertain requests keep their original device and operation, and recovery requires an explicit click rather than automatic replay.

- Keep current navigation and task-detail reads working when leaving a view cancels its shared model read, instead of showing view-loading or task-loading errors. Genuine native read failures remain visible.

- Queue overlapping native view reads so moving a task during a background refresh can finish without a busy-read error. Keep accepted task moves and their displayed positions if a subsequent view refresh fails, instead of reporting that the move failed. Genuine move failures remain visible.

- Planner links use the actual portable collection identifier rather than a local preference namespace, and do not retain another collection's identifier while switching.
- The reusable collection chooser supports name search, marks the current collection, and shows opening progress and failures with Retry. Dismissing it leaves the current page unchanged.

- Coalesce collection-change refreshes while synchronization catches up, and reread retired view snapshots without showing a view-loading error. Reads keep their original deadline and cancellation, and genuine failures still offer Retry.

- Show view-loading failures with Retry throughout the workspace, distinguish them from an empty view catalog, and offer explicit view creation without recreating defaults. View discovery reports bounded outcome and timing diagnostics without record or account details.

- Native sign-in now updates collection readiness after the actual TaskNotes model and source checks, instead of remaining marked as needing setup when an existing collection is ready.
- Update the native sign-in SDK to accept collection cancellation signals correctly. Unexpected opening failures now preserve stored-data guidance and bounded failure categories rather than being treated as sign-in recovery.
- Add privacy-bounded diagnostics for collection-opening failures, preserving the original error without logging account, collection or credential details.
- Keep the sign-in window open through account approval and collection selection, and wait for the original sign-in reply before opening the collection. Known failures now show specific messages with privacy-bounded diagnostics.
- Add bounded startup timing diagnostics for collection opening, bootstrap, setup assessment, the first view query and its first render. Diagnostics contain duration values only, not collection or account details.
- Restore the familiar TaskNotes welcome screen with one Sign in action, automatic approval detection and the signed-in account email when available. Sign-in opens the first-party mdbase popup; collection choices remain in mdbase. The Sign in button uses an arrow rather than an add icon.
- Update the pinned SDK and its packaged native assets while retaining explicit authenticated build-environment selection and the current collection runtime. Accounts without email can show their authenticated GitHub login instead. This does not enable People or the shared collection factory.
- Clarify native Scratchpad recovery limits: opening or listing notes may write, and reloading does not prove recovery of an earlier uncertain operation.
- Older file operations report incomplete metadata if a modification timestamp is unavailable, rather than submitting an incomplete descriptor.
- Opening Scratchpad or starting a new note accepts the portable identity assigned by the native type's creation policy, while retaining the original native record and exact recovery. Existing-note identity checks remain unchanged.
- Create, edit and delete saved Base view sources in native sessions with full-scope edit permission. Read-only and folder-scoped sessions remain non-editable. Changes use the original record identity and complete document readback; deletion confirms the native record is absent before reporting success.
- Editing, customizing or deleting saved views after setup no longer invalidates completed setup or recreates defaults. Readiness follows the collection's current compatible task and view types, including user-defined types.

- Use the registered TaskNotes application name and identifier during explicit sign-in, without migrating earlier protected sign-in data.
- Collections with several task types now show task model settings as read-only, rather than silently editing only the first type.
- TaskNotes setup now installs Scratchpad note and image types. Existing collections can add missing definitions in a separate setup round without replacing their earlier setup history.
- Disable reminder reconciliation in the next app until its timer service is available.
- Previously loaded saved views can show cached rows immediately while refreshing. Cached rows remain marked stale and are cleared when collection data changes.

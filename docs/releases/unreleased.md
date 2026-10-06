# Unreleased

- Keep a reviewed collection setup working when another tab opens the same setup review. If the changes differ, show the new review for confirmation instead of reporting that the collection was deleted.

- Fixed native iOS hosted-collection access failing after successful authorization
  because the bundled webview origin did not match the grant's publisher origin.
  Signed authority requests now use a proof-scoped, cancellable native HTTPS
  transport, retaining exact-origin and callback validation and refusing redirects
  or ambient cookies. Web, Android and connected-computer relay traffic are
  unchanged. Physical-iPhone validation is still required. This does not claim to
  fix the separate missing/mismatched authorization callback error in issue 205.

- Explain when mdbase on this computer needs an update to set up a collection, with an Update mdbase action instead of a generic error.

- Describe monthly recurrence without an explicit day as the anchor's day of the month, instead of incorrectly showing the first Monday. Keep the original rule unchanged until an edit is applied.

- Keep an accepted TaskNotes update available offline. Save and reload waits for the new offline shell, while other open tabs keep the assets they need.

- Start an undated monthly or yearly repeating task on the local calendar date, rather than the UTC day of its creation timestamp.

- Reload saved views automatically when mdbase reconnects after an offline reload, without requiring Retry.

- Offer a TaskNotes update when you return to an old tab. Save task details and notes before reloading; keep the page open when a draft, pending save, or protected edit needs attention.

- Keep the offline save status and task confirmations in separate stacked rows, so a confirmation or Undo notice cannot cover the sync guidance.

- Show plain-language guidance and a retry action when Assigned to me cannot load your person record, instead of displaying an internal request error.

- Preserve hyphenated recurrence words in quick-add titles, such as weekly-review and due-only-weekly, instead of removing part of the title or leaving a stray backslash.

- Anchor a new repeating task to its scheduled date or, when unscheduled, its due date. Save its first planned occurrence so Today and calendar views agree, and show the selected occurrence's dates in task details.

- Keep the Task added confirmation message, Open action, and dismiss control together without an empty second row.

- Explain repeating-task timing with “Planned dates” and keep the raw schedule rule behind “Advanced rule”, instead of showing “Fixed schedule” and “Edit RRULE”.

- Open person-record setup in the Editor configured for this TaskNotes environment, instead of following an outdated Editor address.

- Finish adding a Private collection when its approval window returns to TaskNotes. The window hands the result to the waiting tab and closes, instead of starting a second copy of TaskNotes and leaving the request waiting.

- Show a Private label, with a lock, on Private collections in the collection switcher and chooser.

- Create a subtask only once when you add it again after a connection drop. Previously, retrying Add subtask after the reply was lost could create the subtask twice.

- Keep checking by itself while another tab finishes setting up the collection, instead of stopping at Try again on the setup screen.

- Show long collection names in full in the collection switcher list, and on up to two lines in the switcher button. A longer name is shortened there, with the full name in its tooltip.

- Show changes made in another tab or device in an open task. Fields without an unsaved edit, such as the title or Notes, follow the newer version, while a field you are still editing keeps your edit. Previously the task kept showing its old title and said Saved until it was reopened.

- Say "Saved on this device; waiting for sync" while you are offline or mdbase cannot be reached and changes are waiting to sync, instead of "Sync is taking longer than usual". The collection settings no longer show Connected in that state.

- Show a Scratchpad note title or text changed in another tab or device while the note is open. A title or text you are still editing is kept rather than replaced.

- Keep a task edit made offline when another app changes the same task before it syncs. After a reload the refused edit is shown again, and Keep my edit applies only the fields you changed on top of the latest version, so the other app's change to other fields is kept too. Previously Keep my edit could save the latest version over your edit, leaving Notes empty.

- Keep task edits made just before a reload or closed tab. Leaving the title with Tab or Enter saves it straight away, and edits mdbase had not yet captured are kept in this browser and offered back for review (Restore or Discard) the next time the task opens.

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
- Added a scoped English/French translation pilot for the Collection settings panel, including correctly pluralized refresh counts and localized accessible controls. Normal release UI remains English while the pilot is reviewed.
- Expanded Lingui to the whole application interface with one app-level provider, reviewable generated-ID PO catalogues, localized accessible controls and announcements, ICU counts, and presentation-only date/recurrence/editor labels. Normal releases remain English; French is an incomplete development/e2e preview with English fallback, not an app-wide French translation. User content, saved labels, identifiers and collection/repository behavior are unchanged.

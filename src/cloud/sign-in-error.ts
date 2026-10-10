import { isInstallationErrorCode } from "./next-installation-protocol";

const messages: Record<string, string> = {
  popup_blocked: "Your browser blocked the sign-in window.",
  busy: "TaskNotes is still opening this collection. Please wait.",
  binding:
    "The sign-in reply did not match this device. Keep this browser's stored data and reload TaskNotes.",
  response: "mdbase returned an unexpected sign-in reply. Please try again.",
  refused:
    "mdbase refused access to this collection. Check its permissions in mdbase.",
  expired: "This sign-in request expired. Sign in again to continue.",
  account_confirmation_required:
    "Confirm your account in the mdbase window to continue.",
  recovery_required:
    "This device's earlier sign-in needs recovery. Keep this browser's stored data and reload TaskNotes.",
  outcome_unknown:
    "The sign-in result could not be confirmed. Keep this browser's stored data; do not start a replacement request.",
  fenced:
    "This sign-in session is no longer current. Reload TaskNotes to continue.",
  closed: "This sign-in session has ended. Reload TaskNotes to continue.",
  aborted: "Sign-in stopped before it finished. Reload TaskNotes to continue.",
  unavailable: "The sign-in service is unavailable. Please try again.",
  worker_stopped:
    "The sign-in connection stopped. Keep this browser's stored data and reload TaskNotes.",
};
/** Only fixed public codes may reach diagnostics. Never log Error objects,
 * messages, HTTP bodies, account/collection fields or nested SDK credentials. */
export function signInErrorCode(reason: unknown): string {
  if (isInstallationErrorCode(reason)) return reason;
  if (reason instanceof Error) {
    if ("reason" in reason && isInstallationErrorCode(reason.reason))
      return reason.reason;
    const prefix = "TaskNotes native sign-in: ";
    if (reason.message.startsWith(prefix)) {
      const code = reason.message.slice(prefix.length);
      if (isInstallationErrorCode(code)) return code;
    }
    if (reason.message === "TaskNotes native sign-in is busy.") return "busy";
    if (
      reason.message === "TaskNotes native Worker is closed." ||
      reason.message === "TaskNotes sign-in owner closed."
    )
      return "closed";
    if (
      reason.message ===
      "TaskNotes native outcome unknown; preserve storage and resume the original installation."
    )
      return "outcome_unknown";
    if (
      reason.message ===
      "TaskNotes native Worker stopped; preserve storage and resume the original installation."
    )
      return "worker_stopped";
    if (
      reason.message === "popup_blocked" ||
      reason.message === messages.popup_blocked
    )
      return "popup_blocked";
  }
  return "unknown";
}
export function signInMessage(reason: unknown): string {
  return (
    messages[signInErrorCode(reason)] ??
    "Sign-in was interrupted. Please try again."
  );
}
export type SignInFailureStage =
  "start" | "snapshot" | "authorize" | "renew" | "handoff" | "select" | "popup";
export function logSignInFailure(
  stage: SignInFailureStage,
  reason: unknown,
): void {
  try {
    console.warn(`[TaskNotes sign-in] ${stage}: ${signInErrorCode(reason)}`);
  } catch {
    /* Diagnostics must not change the original operation's outcome. */
  }
}

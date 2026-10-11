import type { MdbaseApplicationSnapshot } from "@mdbase-dev/sdk";
import { signInMessage } from "../cloud/sign-in-error";

const applicationMessages: Readonly<Record<string, string>> = {
  popup_blocked: "Your browser blocked the sign-in window.",
  application_selection_empty:
    "This collection link is empty. Choose another collection to continue.",
  application_selection_metadata:
    "This collection's approved metadata is unavailable. Keep its stored data and reload TaskNotes.",
  application_registration_binding:
    "This build does not match TaskNotes' registered application. Keep this browser's stored data and use the registered build.",
  application_selection_not_approved:
    "This collection needs your approval in mdbase before it can open.",
  application_selection_invalid:
    "This collection link is invalid. Choose another collection to continue.",
  application_selection_duplicate:
    "This collection link has more than one collection request. Choose another collection to continue.",
  application_selection_binding:
    "This collection link could not be used by TaskNotes. Choose another collection to continue.",
  application_selection_fenced:
    "This collection request is no longer current. Reload TaskNotes to continue.",
  application_selection_busy: "TaskNotes is still opening. Please wait.",
  application_not_yet_available:
    "This browser cannot open the shared TaskNotes runtime. Keep its stored data and use a supported app build.",
};

/** Only fixed codes/data descriptors, never error messages, getters or IDs. */
export function applicationProblemMessage(problem: unknown): string {
  let code = typeof problem === "string" ? problem : null;
  if (problem instanceof Error) {
    for (const key of ["reason", "code"]) {
      const descriptor = Object.getOwnPropertyDescriptor(problem, key);
      if (
        descriptor &&
        "value" in descriptor &&
        typeof descriptor.value === "string"
      ) {
        code = descriptor.value;
        break;
      }
    }
  }
  if (code && Object.hasOwn(applicationMessages, code))
    return applicationMessages[code];
  return signInMessage(code);
}

/** Presentation only. Original recovery remains an explicit SDK select action;
 * requested/approved metadata never authorizes a replacement operation. */
export function applicationRecoveryTarget(
  snapshot: MdbaseApplicationSnapshot,
): string | null {
  const request = snapshot.selection.requested;
  if (
    snapshot.signIn?.state !== "paired" ||
    !request.collectionId ||
    !request.approved ||
    !snapshot.collections.some(
      (item) => item.collectionId === request.collectionId,
    )
  )
    return null;
  return (snapshot.status === "unselected" &&
    snapshot.problem === "unavailable") ||
    (snapshot.status === "blocked" && snapshot.problem === "outcome_unknown")
    ? request.collectionId
    : null;
}

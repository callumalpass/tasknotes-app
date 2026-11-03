import type {
  Mdbase,
  MdbaseApplicationConnection,
  MdbaseSnapshot,
} from "@mdbase-dev/sdk";
import type { MdbaseNotificationScope } from "../native/mdbase-notifications";

/** Consent belongs to the original approved grant, not to the signed-in app or
 * a connection generation. A reapproval must never inherit local opt-in. */
export function notificationScope(
  connection: MdbaseApplicationConnection,
  snapshot: MdbaseSnapshot,
): MdbaseNotificationScope {
  const { scope } = connection;
  const signIn = snapshot.signIn;
  const consent = signIn?.timerConsent;
  const grant =
    signIn?.accountId === scope.account &&
    signIn.installationId === scope.installation &&
    consent?.approved
      ? consent.grants.find((value) => value.collectionId === scope.collection)
      : undefined;
  return {
    key: JSON.stringify([
      scope.account,
      scope.installation,
      scope.collection,
      grant?.grantId ?? null,
    ]),
    // A port without its original approved identity is not usable for opt-in.
    timers: grant ? connection.timers : undefined,
  };
}

/** The shared collection UI invokes this same facade. Stop notifications while
 * the original port is still alive; a failed/unknown opt-out blocks teardown. */
export function withNotificationTeardown(
  mdbase: Mdbase,
  notifications: { disableIfEnabled(): Promise<void> },
): Mdbase {
  return {
    ...mdbase,
    async signOut(options) {
      await notifications.disableIfEnabled();
      return mdbase.signOut(options);
    },
    async deleteCollection(id, options) {
      if (mdbase.getSnapshot().selection.usable?.collectionId === id)
        await notifications.disableIfEnabled();
      return mdbase.deleteCollection(id, options);
    },
  };
}

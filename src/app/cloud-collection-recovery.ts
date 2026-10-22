import type { AppWebSignInSnapshot } from "@mdbase-dev/sdk/app-host";

/** Presentation only, not retry authority. The SDK checks original operation,
 * device/keys/current approval and physical stop before reconciling this target. */
export function collectionRecoveryTarget(
  snapshot: AppWebSignInSnapshot,
): string | null {
  const id = snapshot.selectedCollectionId;
  return snapshot.signIn?.state === "paired" &&
    id !== null &&
    snapshot.collections.some((collection) => collection.collectionId === id) &&
    ((snapshot.status === "unselected" && snapshot.problem === "unavailable") ||
      (snapshot.status === "blocked" && snapshot.problem === "outcome_unknown"))
    ? id
    : null;
}

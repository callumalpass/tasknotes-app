import type { MdbaseSnapshot } from "@mdbase-dev/sdk";

/** Presentation only, from the SDK's server-classified migration outcome.
 * Generic fencing, missing access and local recovery are NOT migration proof. */
export function isAccountUpgradeWait(snapshot: MdbaseSnapshot): boolean {
  return (
    snapshot.problem === "collection_migrating" ||
    ((snapshot.phase.kind === "problem" || snapshot.phase.kind === "ready") &&
      snapshot.phase.problem?.code === "collection_migrating")
  );
}

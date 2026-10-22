import type { wire } from "@mdbase-dev/sdk";
import {
  ModelSetupError,
  type ModelSetupView,
} from "../application/ports/model-setup";

type SetupStatus = Pick<
  wire.SyncStatus,
  "confirmedThrough" | "headKnown" | "incidents"
>;

/** Negative fence only: a readable old prefix cannot prove resource absence.
 * Clearing this fence is NOT readiness; bounded native inventory/readback still
 * decides whether the collection needs setup. Pending task edits are unrelated.
 */
export function setupAvailability(
  status: SetupStatus | undefined,
): Extract<ModelSetupView, { state: "waiting" }> | null {
  if (status?.incidents.some((incident) => incident.kind === "waiting_for_key"))
    return {
      state: "waiting",
      reason: "waiting_for_access",
      message:
        "Waiting for access to this collection. Its existing setup will be checked when access is ready.",
    };
  if (
    status &&
    Number.isSafeInteger(status.confirmedThrough) &&
    Number.isSafeInteger(status.headKnown) &&
    status.confirmedThrough < status.headKnown
  )
    return {
      state: "waiting",
      reason: "catching_up",
      message:
        "Catching up with this collection. Its existing setup will be checked when the download finishes.",
    };
  return null;
}

export function requireSetupAvailability(
  status: SetupStatus | undefined,
): void {
  const waiting = setupAvailability(status);
  if (waiting) throw new ModelSetupError(waiting);
}

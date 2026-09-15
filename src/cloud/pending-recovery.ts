import type {
  ConnectRequestOptions,
  PendingMutation,
} from "@mdbase-dev/connect";
import { connectProblemFromError, requireConnectOutcome } from "./outcome";

export interface PendingRecoveryEntry {
  requestId: string;
  operation: string;
  createdAt: string;
  status:
    | "waiting"
    | "checking"
    | "confirmed"
    | "unresolved"
    | "expired"
    | "authorization"
    | "unavailable";
  message: string;
}

export function pendingRecoveryEntry(
  pending: Pick<PendingMutation, "requestId" | "operation" | "createdAt">,
): PendingRecoveryEntry {
  return {
    requestId: pending.requestId,
    operation: pending.operation,
    createdAt: pending.createdAt,
    status: "waiting",
    message: "Waiting to check the exact saved request.",
  };
}

/** Recover original SDK handles only. Never reconstruct writes or edit storage. */
export async function recoverPendingChanges(
  pending: readonly PendingMutation[],
  options: ConnectRequestOptions,
  onProgress: (entry: PendingRecoveryEntry) => void,
): Promise<void> {
  for (const handle of pending) {
    const entry = pendingRecoveryEntry(handle);
    onProgress({
      ...entry,
      status: "checking",
      message: "Checking the exact saved request…",
    });
    try {
      requireConnectOutcome(await handle.recover(options));
      // A successful transport can contain a rejected operation result. Do not
      // infer that a mutation applied from the generic SDK outcome alone.
      onProgress({
        ...entry,
        status: "confirmed",
        message: "The saved request’s result was recovered.",
      });
    } catch (error) {
      const problem = connectProblemFromError(error);
      if (problem?.code === "mutation_recovery_expired") {
        onProgress({
          ...entry,
          status: "expired",
          message:
            "The recovery window expired. The earlier change may have applied; inspect the collection before making it again.",
        });
      } else if (problem?.recovery === "reauthorize") {
        onProgress({
          ...entry,
          status: "authorization",
          message:
            "The original authorization or keys need attention. Keep recovery saved; reconnecting does not establish whether the earlier change applied.",
        });
      } else if (problem?.recovery === "retry") {
        onProgress({
          ...entry,
          status: "unavailable",
          message:
            "The check could not complete. Keep recovery saved and try again when the connection is available.",
        });
      } else {
        onProgress({
          ...entry,
          status: "unresolved",
          message:
            "The earlier change may have applied, but its result is still unconfirmed. Keep recovery saved; do not repeat it as a new change.",
        });
      }
    }
  }
}

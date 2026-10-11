import type { ConnectProblem } from "@mdbase-dev/connect";
import {
  isMdbaseError,
  type ErrorCode,
  type MdbaseError,
} from "@mdbase-dev/sdk";

/** Preserve the SDK problem rather than passing replica codes through the
 * legacy Connect catalog, which does not recognize most of them. */
type ReplicaProblem = ReturnType<MdbaseError["toProblem"]> & {
  category: ConnectProblem["category"];
  operation_outcome?: ConnectProblem["operation_outcome"];
  mutationId?: MdbaseError["mutationId"];
  mutationIds?: MdbaseError["mutationIds"];
};

export type ApplicationConnectProblem = ConnectProblem | ReplicaProblem;

const REPLICA_CATEGORIES: Record<ErrorCode, ConnectProblem["category"]> = {
  invalid_request: "validation",
  invalid_record: "validation",
  not_found: "validation",
  conflict: "conflict",
  unauthenticated: "authorization",
  forbidden: "authorization",
  collection_invalid: "integrity",
  unavailable: "availability",
  rate_limited: "availability",
  quota_exceeded: "availability",
  too_large: "validation",
  upgrade_required: "compatibility",
  outcome_unknown: "unknown",
  cancelled: "cancellation",
  internal: "internal",
};

/** Read real replica exceptions and preserve legacy structured carriers.
 * Bare codes and developer messages are never treated as structured failures. */
export function connectProblemFromError(
  error: unknown,
): ApplicationConnectProblem | null {
  if (isMdbaseError(error)) {
    return {
      ...error.toProblem(),
      category: REPLICA_CATEGORIES[error.code] ?? "unknown",
      mutationId: error.mutationId,
      mutationIds: error.mutationIds,
    };
  }
  if (!error || typeof error !== "object" || !("problem" in error)) return null;
  const problem = error.problem;
  if (!problem || typeof problem !== "object") return null;
  if (!("code" in problem) || typeof problem.code !== "string") return null;
  if (!("message" in problem) || typeof problem.message !== "string")
    return null;
  return problem as ConnectProblem;
}

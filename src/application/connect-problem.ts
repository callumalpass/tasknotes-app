import {
  isMdbaseError,
  type ErrorCode,
  type MdbaseError,
} from "@mdbase-dev/sdk";

/** Application policy over the SDK's typed failures; diagnostics stay intact. */
export type ApplicationConnectProblem = ReturnType<MdbaseError["toProblem"]> & {
  category:
    | "validation"
    | "conflict"
    | "authorization"
    | "integrity"
    | "availability"
    | "compatibility"
    | "cancellation"
    | "internal"
    | "unknown";
  mutationId?: MdbaseError["mutationId"];
  mutationIds?: MdbaseError["mutationIds"];
};

const REPLICA_CATEGORIES: Record<
  ErrorCode,
  ApplicationConnectProblem["category"]
> = {
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

/** Bare codes, developer prose and lookalike carriers are not SDK failures. */
export function connectProblemFromError(
  error: unknown,
): ApplicationConnectProblem | null {
  if (!isMdbaseError(error)) return null;
  return {
    ...error.toProblem(),
    category: REPLICA_CATEGORIES[error.code],
    mutationId: error.mutationId,
    mutationIds: error.mutationIds,
  };
}

import type {
  ConnectOutcome,
  ConnectProblem,
  ConnectProblemCode,
} from "@mdbase-dev/connect";

/** TaskNotes' narrow exception adapter at the SDK outcome boundary. */
export class TaskNotesConnectOutcomeError extends Error {
  constructor(
    public readonly problem: ConnectProblem,
    options: { cause?: unknown } = {},
  ) {
    super(problem.message, options);
    this.name = "TaskNotesConnectOutcomeError";
  }

  get code(): ConnectProblem["code"] {
    return this.problem.code;
  }

  get details(): unknown {
    return this.problem.details;
  }
}

export function requireConnectOutcome<Value, Code extends ConnectProblemCode>(
  outcome: ConnectOutcome<Value, Code>,
): Value {
  if (!outcome.ok) throw new TaskNotesConnectOutcomeError(outcome.problem);
  return outcome.value;
}

export { connectProblemFromError } from "../application/connect-problem";

export function noPendingMutationError(): TaskNotesConnectOutcomeError {
  return new TaskNotesConnectOutcomeError({
    problem_version: 1,
    code: "no_pending_mutation",
    category: "conflict",
    recovery: "refresh",
    message: "There is no interrupted mutation to resume.",
  });
}

export function pendingRecoveryError(
  requestId: string,
  cause: unknown,
): TaskNotesConnectOutcomeError {
  return new TaskNotesConnectOutcomeError(
    {
      problem_version: 1,
      code: "operation_outcome_unknown",
      category: "conflict",
      recovery: "resolve_outcome",
      operation_outcome: "unknown",
      message:
        "The earlier change may have been applied, but its result could not be confirmed. Keep the collection connected and retry exact recovery.",
      details: { request_id: requestId },
    },
    { cause },
  );
}

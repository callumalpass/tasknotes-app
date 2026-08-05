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

export function connectProblemFromError(error: unknown): ConnectProblem | null {
  if (error instanceof TaskNotesConnectOutcomeError) return error.problem;
  if (!error || typeof error !== "object" || !("problem" in error)) return null;
  const problem = error.problem;
  if (!problem || typeof problem !== "object") return null;
  if (!("code" in problem) || typeof problem.code !== "string") return null;
  if (!("message" in problem) || typeof problem.message !== "string")
    return null;
  return problem as ConnectProblem;
}

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
        "TaskNotes is still confirming an earlier change. This change was not sent. Keep the collection connected and retry recovery.",
      details: { request_id: requestId },
    },
    { cause },
  );
}

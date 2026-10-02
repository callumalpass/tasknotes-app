import type { ConnectProblem } from "@mdbase-dev/connect";
import { connectProblemFromError } from "./connect-problem";
import { TaskNotesValidationError } from "../domain/tasknotes-model";

export type OperationalErrorCode =
  | "unavailable"
  | "permission-denied"
  | "cancelled"
  | "outcome-unknown"
  | "conflict"
  | "validation"
  | "not-found"
  | "unknown";

/** A stable failure vocabulary shared by use cases and presentation. */
export class OperationalError extends Error {
  readonly detail: string;
  readonly problem: ConnectProblem | null;

  constructor(
    readonly code: OperationalErrorCode,
    readonly operation: string,
    readonly retryable: boolean,
    detail: string,
    options: { cause?: unknown } = {},
  ) {
    super(`${operation}: ${detail}`, options);
    this.name = "OperationalError";
    this.detail = detail;
    // Retain exact recovery identity, outcome, policy and diagnostics for callers.
    this.problem = connectProblemFromError(options.cause);
  }
}

export function toOperationalError(
  reason: unknown,
  operation: string,
): OperationalError {
  if (reason instanceof OperationalError) return reason;
  const problem = connectProblemFromError(reason);
  const detail = reason instanceof Error ? reason.message : String(reason);
  const code = problem
    ? classifyProblem(problem)
    : reason instanceof DOMException && reason.name === "AbortError"
      ? "cancelled"
      : reason instanceof TaskNotesValidationError
        ? "validation"
        : reason instanceof TypeError
          ? "unavailable"
          : "unknown";
  const retryable = problem
    ? code !== "outcome-unknown" &&
      (problem.recovery === "retry" || problem.recovery === "refresh") &&
      (code === "unavailable" || code === "conflict")
    : code === "unavailable";
  return new OperationalError(code, operation, retryable, detail, {
    cause: reason,
  });
}

function classifyProblem(problem: ConnectProblem): OperationalErrorCode {
  // Unknown acceptance outranks category (often conflict or availability).
  if (
    problem.operation_outcome === "unknown" ||
    problem.recovery === "resolve_outcome"
  )
    return "outcome-unknown";
  if (problem.code === "file_not_found") return "not-found";
  switch (problem.category) {
    case "availability":
      return "unavailable";
    case "authorization":
      return "permission-denied";
    case "cancellation":
      return "cancelled";
    case "validation":
      return "validation";
    case "conflict":
      return "conflict";
    default:
      return "unknown";
  }
}

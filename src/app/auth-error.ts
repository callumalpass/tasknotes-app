import { connectProblemFromError } from "../cloud/outcome";

export function isAuthorizationError(reason: unknown): boolean {
  const problem = connectProblemFromError(reason);
  if (
    !problem ||
    problem.operation_outcome === "unknown" ||
    problem.recovery === "resolve_outcome"
  )
    return false;
  return (
    problem.category === "authorization" || problem.recovery === "reauthorize"
  );
}

export function technicalErrorMessage(reason: unknown): string {
  return reason instanceof Error && reason.message
    ? reason.message
    : "The collection could not be opened.";
}

import { connectProblemFromError } from "../application/connect-problem";

export function isAuthorizationError(reason: unknown): boolean {
  const problem = connectProblemFromError(reason);
  if (!problem || problem.recovery === "resolve_outcome") return false;
  return (
    problem.category === "authorization" || problem.recovery === "reauthorize"
  );
}

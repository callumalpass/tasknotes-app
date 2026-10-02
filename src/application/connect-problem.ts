import type { ConnectProblem } from "@mdbase-dev/connect";

/** Extract structured failure data without depending on an SDK exception class.
 * Both the outcome adapter and SDK internal carriers expose this same shape. */
export function connectProblemFromError(error: unknown): ConnectProblem | null {
  if (!error || typeof error !== "object" || !("problem" in error)) return null;
  const problem = error.problem;
  if (!problem || typeof problem !== "object") return null;
  if (!("code" in problem) || typeof problem.code !== "string") return null;
  if (!("message" in problem) || typeof problem.message !== "string")
    return null;
  return problem as ConnectProblem;
}

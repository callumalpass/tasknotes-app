import type { MdbaseSnapshot } from "@mdbase-dev/sdk";

/** The SDK's own code for a problem that stops a collection opening. */
export interface OpenProblemReference {
  readonly code: string;
  readonly developerMessage: string | null;
}

// describeError only reports validated SDK codes; keep that bound here too.
const CODE = /^[a-z][a-z0-9_-]{0,127}$/;

/**
 * The code behind an error-severity open or start problem, or null. Those
 * screens use copy such as "Something went wrong" that names no cause, so the
 * code is the only thing support can act on. Warnings and information
 * (approval, offline, setup) already say what to do and get nothing extra.
 */
export function openProblemReference(
  snapshot: Pick<MdbaseSnapshot, "phase">,
): OpenProblemReference | null {
  const phase = snapshot.phase;
  if (phase.kind !== "problem" && phase.kind !== "unavailable") return null;
  const problem = phase.problem;
  if (problem.severity !== "error" || !CODE.test(problem.code)) return null;
  return {
    code: problem.code,
    developerMessage: problem.developerMessage ?? null,
  };
}

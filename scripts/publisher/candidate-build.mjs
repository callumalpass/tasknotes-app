// Imported from the candidate ONLY after the workflow-owned ALL-original gate.
import { execFileSync } from "node:child_process";
export function buildCandidate(env) {
  execFileSync("pnpm", ["rebuild", "--pending"], { env, stdio: "inherit" });
  execFileSync("pnpm", ["run", "build:assets"], { env, stdio: "inherit" });
}

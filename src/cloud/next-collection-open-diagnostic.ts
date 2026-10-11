import { signInErrorCode } from "./sign-in-error";
export type CollectionOpenStage =
  | "construct"
  | "current_check"
  | "creation_intent"
  | "join_intent"
  | "bootstrap"
  | "join_complete"
  | "receipt"
  | "sql_open"
  | "verified_read"
  | "data_facade";
const names = new Set([
  "Error",
  "TypeError",
  "ReferenceError",
  "RangeError",
  "SyntaxError",
  "AbortError",
  "SecurityError",
  "InvalidStateError",
  "NotFoundError",
  "ConstraintError",
  "VersionError",
  "QuotaExceededError",
  "DataError",
  "UnknownError",
  "TransactionInactiveError",
]);
const members = new Set([
  "isCurrent",
  "scope",
  "collection",
  "account",
  "installation",
  "begin",
  "open",
  "openCollection",
  "createObjectStore",
  "transaction",
  "indexedDB",
  "AbortSignal",
  "MessageChannel",
  "WorkerGlobalScope",
  "crypto",
  "performance",
]);
/** Preserve the actual failure while reporting only static categories and exact
 * owned-script line/column positions. Arbitrary messages, stack first lines,
 * function names, URLs, bodies, identifiers and credential values are omitted. */
export function logCollectionOpenFailure(
  stage: CollectionOpenStage,
  error: unknown,
  scriptUrl?: string,
): void {
  try {
    const name =
      error instanceof Error && names.has(error.name) ? error.name : "Error";
    let message = "unclassified exception (message redacted)";
    if (error instanceof Error && name === "ReferenceError") {
      const member = /^([A-Za-z_$][A-Za-z0-9_$]*) is not defined$/.exec(
        error.message,
      )?.[1];
      if (member && members.has(member)) message = `${member} is not defined`;
    }
    if (error instanceof Error && name === "TypeError") {
      const match =
        /^Cannot read properties of (undefined|null) \(reading '([A-Za-z_$][A-Za-z0-9_$]*)'\)$/.exec(
          error.message,
        );
      if (match && members.has(match[2]!))
        message = `Cannot read properties of ${match[1]} (reading '${match[2]}')`;
    }
    const reason = signInErrorCode(error);
    if (reason !== "unknown") message = `public failure: ${reason}`;
    const stack: string[] = [];
    if (
      error instanceof Error &&
      typeof error.stack === "string" &&
      scriptUrl
    ) {
      const script = new URL(scriptUrl);
      for (const token of error.stack
        .slice(0, 16384)
        .match(/https?:\/\/[^\s)]+/g) ?? []) {
        const match = /^(.*):(\d{1,9}):(\d{1,9})$/.exec(token);
        if (!match) continue;
        const frame = new URL(match[1]!);
        if (
          frame.origin === script.origin &&
          frame.pathname === script.pathname &&
          !frame.search &&
          !frame.hash
        ) {
          stack.push(`owned-worker:${match[2]}:${match[3]}`);
          if (stack.length === 8) break;
        }
      }
    }
    console.error(
      "[TaskNotes collection open]",
      JSON.stringify({ stage, name, reason, message, stack }),
    );
  } catch {
    /* Diagnostics never replace or mask the original thrown value. */
  }
}

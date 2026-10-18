import { connectProblemFromError } from "./connect-problem";

/**
 * mdbase is moving collections to a new sync service. Once a collection has
 * moved, or while it is moving, the service refuses requests from this version
 * with a plain-language `message` that is meant to be shown verbatim.
 *
 * - `update`: the collection now needs a newer TaskNotes.
 * - `migrating`: the collection is temporarily paused while it moves.
 * - `suspended`: the account cannot be used until support restores it.
 */
export type CutoverKind = "update" | "migrating" | "suspended";

export interface CutoverProblem {
  kind: CutoverKind;
  /** The server code, kept for diagnostics only; never shown as the message. */
  code: string;
  /** The server's plain-language explanation, shown verbatim. */
  message: string;
  updateUrl: string | null;
  supportUrl: string | null;
  retryAfterSeconds: number | null;
  minimumClientVersion: string | null;
}

const HEADINGS: Record<CutoverKind, string> = {
  update: "Update TaskNotes",
  migrating: "Your collection is being upgraded",
  suspended: "Your mdbase account is unavailable",
};

export function cutoverHeading(problem: CutoverProblem): string {
  return HEADINGS[problem.kind];
}

const UPDATE_CODES = new Set(["collection_unavailable", "onboarding_moved"]);
const MIGRATING_CODES = new Set(["collection_migrating", "migrating"]);
const SUSPENDED_CODES = new Set(["account_suspended", "suspended"]);
const MOVED_REASON = "moved_to_next_runtime";

/**
 * Recognise a cutover refusal from an error, an error carrying `problem`, or a
 * bare problem object. Anything else, including a cutover code without a
 * usable message, returns null so callers keep their existing behaviour.
 */
export function cutoverProblemFrom(reason: unknown): CutoverProblem | null {
  const problem = problemRecord(reason);
  if (!problem) return null;
  const message =
    typeof problem.message === "string" ? problem.message.trim() : "";
  if (!message) return null;
  // This SDK predates the cutover codes, so it reports them as `unknown`
  // with the original code in `server_code`. Newer SDKs may report them directly.
  const code =
    problem.code === "unknown" && typeof problem.server_code === "string"
      ? problem.server_code
      : typeof problem.code === "string"
        ? problem.code
        : "";
  const details = record(problem.details);
  const kind = cutoverKind(code, details);
  if (!kind) return null;
  return {
    kind,
    code,
    message,
    updateUrl: httpsUrl(details?.update_url),
    supportUrl: httpsUrl(details?.support_url),
    retryAfterSeconds: positiveSeconds(details?.retry_after_seconds),
    minimumClientVersion:
      typeof details?.minimum_client_version === "string"
        ? details.minimum_client_version
        : null,
  };
}

function cutoverKind(
  code: string,
  details: Record<string, unknown> | null,
): CutoverKind | null {
  if (UPDATE_CODES.has(code)) {
    // `collection_unavailable` is also an ordinary availability code. Treat it
    // as a cutover only when the server says the collection has moved.
    if (code === "onboarding_moved") return "update";
    return details?.reason === MOVED_REASON ||
      typeof details?.update_url === "string"
      ? "update"
      : null;
  }
  if (MIGRATING_CODES.has(code)) return "migrating";
  if (SUSPENDED_CODES.has(code)) return "suspended";
  return null;
}

const FIRST_RETRY_SECONDS = 30;
const DEFAULT_MAX_RETRY_SECONDS = 300;

/**
 * Delay before the next automatic check while a collection is moving. Starts
 * at 30 seconds and doubles, never waiting longer than the server's suggested
 * retry interval (five minutes by default). Jitter spreads reconnects out.
 */
export function migratingRetryDelayMs(
  attempt: number,
  retryAfterSeconds: number | null,
  random: () => number = Math.random,
): number {
  const ceiling = retryAfterSeconds ?? DEFAULT_MAX_RETRY_SECONDS;
  const base = Math.min(
    ceiling,
    FIRST_RETRY_SECONDS * 2 ** Math.max(0, Math.min(attempt, 10)),
  );
  const jitter = 0.8 + random() * 0.4;
  return Math.round(Math.max(1, base * jitter) * 1000);
}

function problemRecord(reason: unknown): Record<string, unknown> | null {
  const carried = connectProblemFromError(reason);
  if (carried) return carried as unknown as Record<string, unknown>;
  const direct = record(reason);
  return direct &&
    typeof direct.code === "string" &&
    typeof direct.message === "string"
    ? direct
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function positiveSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

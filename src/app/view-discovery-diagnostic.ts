import { MdbaseError } from "@mdbase-dev/sdk";

export type ViewDiscoveryOutcome = "ok" | "empty" | "error";
export const VIEW_DISCOVERY_DIAGNOSTIC = "[TaskNotes view discovery]";
const reasons: Readonly<Record<string, readonly string[]>> = {
  invalid_request: [
    "unknown_param",
    "bad_request",
    "invalid_source",
    "unsupported",
  ],
  conflict: ["collection_changed", "source_changed", "catalog_changed"],
  forbidden: ["insufficient_access"],
  unavailable: [
    "collection_unusable",
    "disconnected",
    "session_closed",
    "fenced",
  ],
};
const codes = new Set([
  "invalid_request",
  "invalid_record",
  "not_found",
  "conflict",
  "unauthenticated",
  "forbidden",
  "collection_invalid",
  "unavailable",
  "rate_limited",
  "quota_exceeded",
  "too_large",
  "upgrade_required",
  "outcome_unknown",
  "cancelled",
  "internal",
]);

function classification(error: unknown): {
  code: string | null;
  reason: string | null;
} {
  try {
    if (error instanceof MdbaseError) {
      // Read own data fields only; never invoke arbitrary exception getters.
      const code: unknown = Object.getOwnPropertyDescriptor(
        error,
        "code",
      )?.value;
      const reason: unknown = Object.getOwnPropertyDescriptor(
        error,
        "reason",
      )?.value;
      if (typeof code === "string" && codes.has(code))
        return {
          code,
          reason:
            typeof reason === "string" && reasons[code]?.includes(reason)
              ? reason
              : null,
        };
    }
    if (error instanceof DOMException && error.name === "AbortError")
      return { code: "cancelled", reason: null };
  } catch {
    /* Hostile exceptions remain unclassified, never logged verbatim. */
  }
  return { code: null, reason: null };
}
function duration(value: number | null): number | null {
  return value !== null &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 120_000
    ? Math.round(value)
    : null;
}

/** One fixed-schema diagnostic for a refresh of the existing discovery READ.
 * Counts are null when unknown/out of bounds, never fabricated zero. No error
 * messages/stacks, identifiers, paths, contents, URLs or custody are emitted.
 * This describes a READ outcome, not authority, READY or retry admission. */
export function logViewDiscovery({
  outcome,
  viewCount,
  stage,
  error,
  published,
  totalMs,
  discoveryMs,
}: {
  outcome: ViewDiscoveryOutcome;
  viewCount: number | null;
  stage: "metadata" | "discovery";
  error?: unknown;
  published: boolean;
  totalMs: number;
  discoveryMs: number | null;
}): void {
  try {
    const count =
      viewCount !== null &&
      Number.isSafeInteger(viewCount) &&
      viewCount >= 0 &&
      viewCount <= 100_000
        ? viewCount
        : null;
    const failure =
      outcome === "error"
        ? classification(error)
        : { code: null, reason: null };
    console.info(
      VIEW_DISCOVERY_DIAGNOSTIC,
      JSON.stringify({
        outcome,
        viewCount: count,
        stage,
        ...failure,
        published,
        timings: {
          totalMs: duration(totalMs),
          discoveryMs: duration(discoveryMs),
        },
      }),
    );
  } catch {
    /* Reporting cannot change the discovery result or original error. */
  }
}

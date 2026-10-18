import { normalizeConnectProblem } from "@mdbase-dev/connect-protocol";

/** Refusal bodies as the mdbase service sends them during the sync-service move. */
const UPDATE_URL = "https://mdbase.dev/downloads";

export const CUTOVER_MESSAGES = {
  moved:
    "mdbase has been updated. Copy any unsaved work somewhere safe, then reload this page to continue. If you use the desktop or mobile app, " +
    `download the latest version from ${UPDATE_URL}.`,
  onboarding_moved:
    "mdbase has been updated. Copy any unsaved work somewhere safe, then reload this page to continue. Open an updated app to finish setting " +
    `up your starter collection. For desktop or mobile, update from ${UPDATE_URL}.`,
  migrating:
    "This collection is being upgraded. Your data is safe, and editing will resume once the upgrade finishes. Try again in a few minutes.",
  suspended:
    "This mdbase account is suspended. Contact mdbase support to restore access.",
} as const;

export type CutoverFixtureKind = keyof typeof CUTOVER_MESSAGES;

export function cutoverBody(
  kind: CutoverFixtureKind,
  extraDetails: Record<string, unknown> = {},
): {
  error: { code: string; message: string; details?: Record<string, unknown> };
} {
  const moved = {
    reason: "moved_to_next_runtime",
    update_url: UPDATE_URL,
    ...extraDetails,
  };
  switch (kind) {
    case "moved":
      return {
        error: {
          code: "collection_unavailable",
          message: CUTOVER_MESSAGES.moved,
          details: moved,
        },
      };
    case "onboarding_moved":
      return {
        error: {
          code: "onboarding_moved",
          message: CUTOVER_MESSAGES.onboarding_moved,
          details: moved,
        },
      };
    case "migrating":
      return {
        error: {
          code: "collection_migrating",
          message: CUTOVER_MESSAGES.migrating,
          details: { retry_after_seconds: 300, ...extraDetails },
        },
      };
    case "suspended":
      return {
        error: {
          code: "account_suspended",
          message: CUTOVER_MESSAGES.suspended,
          ...(Object.keys(extraDetails).length
            ? { details: extraDetails }
            : {}),
        },
      };
  }
}

/** The failure the pinned SDK raises for such a response. */
export function cutoverRefusal(
  kind: CutoverFixtureKind,
  extraDetails?: Record<string, unknown>,
) {
  const { error } = cutoverBody(kind, extraDetails);
  const problem = normalizeConnectProblem(error.code, error.message, {
    details: error.details,
  });
  return Object.assign(new Error(error.message), { problem });
}

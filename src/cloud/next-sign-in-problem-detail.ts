import type { AppWebSignInProblemDetail } from "@mdbase-dev/sdk/app-host";

// SDK832's bounded runtime classifier vocabulary, qualified with SDKb9965703.
// These diagnostics are presentation only, never admission or retry authority.
const appNames = new Set([
  "AppInstallationSignInError",
  "AppCloudCopyHostError",
  "AppCloudCopyBootstrapError",
  "AppCollectionSetupError",
  "AppCollectionControlError",
  "AppCollectionJoinError",
]);
const appCodes = new Set([
  "binding",
  "fenced",
  "busy",
  "account_confirmation_required",
  "outcome_unknown",
  "response",
  "refused",
  "expired",
  "recovery_required",
  "unavailable",
]);
const mdbaseCodes = new Set([
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
const domCodes = new Set([
  "AbortError",
  "ConstraintError",
  "DataCloneError",
  "InvalidStateError",
  "NotAllowedError",
  "NotFoundError",
  "NotReadableError",
  "OperationError",
  "QuotaExceededError",
  "SecurityError",
  "TimeoutError",
  "TransactionInactiveError",
  "UnknownError",
  "VersionError",
]);
const builtinNames = new Set([
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "URIError",
  "EvalError",
  "Error",
  "UnknownError",
]);

export function isNextSignInProblemDetail(
  value: unknown,
): value is AppWebSignInProblemDetail {
  try {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Reflect.ownKeys(value).length !== 2 ||
      !Object.hasOwn(value, "name") ||
      !Object.hasOwn(value, "code") ||
      !("name" in value) ||
      !("code" in value)
    )
      return false;
    const { name, code } = value;
    if (
      typeof name !== "string" ||
      !(code === null || typeof code === "string")
    )
      return false;
    if (appNames.has(name)) return code === null || appCodes.has(code);
    if (name === "MdbaseError") return code === null || mdbaseCodes.has(code);
    if (name === "DOMException") return code === null || domCodes.has(code);
    return builtinNames.has(name) && code === null;
  } catch {
    return false;
  }
}

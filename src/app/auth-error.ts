const authorizationErrorCodes = new Set([
  "authorization_expired",
  "encryption_binding_stale",
  "hosted_authorization_changed",
  "invalid_grant",
  "not_authorized",
  "relay_authorization_expired",
]);

export function isAuthorizationError(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return false;
  const code = "code" in reason ? reason.code : undefined;
  return typeof code === "string" && authorizationErrorCodes.has(code);
}

export function technicalErrorMessage(reason: unknown): string {
  return reason instanceof Error && reason.message
    ? reason.message
    : "The collection could not be opened.";
}

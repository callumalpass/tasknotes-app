// Only fixed enum/status evidence may cross a Google API failure boundary.
// Never return messages, metadata, credential projects, resource IDs or payloads.
export async function googleApiFailure(response) {
  let reason =
    response.status === 403
      ? "permission-denied"
      : response.status === 401
        ? "unauthenticated"
        : response.status === 404
          ? "api-or-resource-not-found"
          : "google-api-unavailable";
  try {
    const body = await response.json();
    const reasons = (body.error?.details ?? []).map((d) => d.reason);
    if (reasons.includes("SERVICE_DISABLED")) reason = "api-service-disabled";
    if (reasons.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT"))
      reason = "oauth-scope-insufficient";
  } catch {
    /* Invalid body is not evidence and must never be logged. */
  }
  return Object.assign(new Error("google-api-observation-unavailable"), {
    httpStatus: response.status,
    reason,
  });
}

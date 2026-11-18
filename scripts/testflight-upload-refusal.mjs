// The altool upload log can hold account, team, key and delivery identifiers,
// so it never leaves the runner. When an upload is not confirmed (see
// testflight-upload.mjs, which asks App Store Connect for the exact build),
// only one of these fixed reasons is printed and retained. The first match
// wins, so specific Apple refusals come before generic transport failures.
export const UPLOAD_REFUSED = "testflight-upload-refused";
const SLUG = /^testflight-[a-z0-9-]{1,80}$/;
const classes = [
  [
    "testflight-build-number-duplicate",
    /ENTITY_ERROR\.ATTRIBUTE\.INVALID\.DUPLICATE|Redundant Binary Upload|bundle version must be higher than the previously uploaded/i,
  ],
  [
    "testflight-version-train-closed",
    /train version .* is closed|Invalid Pre-Release Train|higher (?:version )?than (?:that of )?the previously approved version|ITMS-90186|ITMS-90062/i,
  ],
  ["testflight-upload-limit", /ITMS-90382|upload limit/i],
  [
    "testflight-agreement-required",
    /agreement|FORBIDDEN\.REQUIRED_AGREEMENTS/i,
  ],
  [
    "testflight-auth-refused",
    /NOT_AUTHORIZED|(?:HTTP|status(?: code)?)[ :=]*40[13]\b|Unauthenticated|Authentication failed|unable to authenticate|invalid (?:api )?key|FORBIDDEN_ERROR/i,
  ],
  [
    "testflight-service-unavailable",
    /(?:HTTP|status(?: code)?)[ :=]*50[0234]\b|Service Unavailable|Internal Server Error|try again later/i,
  ],
  [
    "testflight-transport",
    /NSURLErrorDomain|timed out|network connection was lost|could not connect|-100[19]\b/i,
  ],
];

// Apple validation failures carry a public ITMS code (for example ITMS-90717).
// The code is an error catalogue number, not an account identifier.
const ITMS = /\bITMS-(\d{4,5})\b/;

export function uploadRefusalClass(log, status) {
  if (typeof log !== "string") return "testflight-upload-log-missing";
  for (const [reason, pattern] of classes) if (pattern.test(log)) return reason;
  const itms = ITMS.exec(log);
  if (itms) return `testflight-validation-itms-${itms[1]}`;
  // altool exited 0 but App Store Connect never listed the exact build.
  if (String(status) === "0") return "testflight-build-not-visible";
  return "testflight-upload-unclassified";
}

export function uploadRefusal(reason, runId) {
  if (!SLUG.test(reason ?? "") || !Number.isSafeInteger(runId) || runId <= 0)
    throw new Error("Invalid TestFlight upload refusal");
  return { outcome: UPLOAD_REFUSED, reason, run_id: runId };
}

// The coordinator accepts only a receipt bound to the exact build run.
export function uploadRefusalReason(result, runId) {
  return result &&
    Object.keys(result).sort().join() === "outcome,reason,run_id" &&
    result.outcome === UPLOAD_REFUSED &&
    result.run_id === runId &&
    SLUG.test(result.reason ?? "")
    ? result.reason
    : null;
}

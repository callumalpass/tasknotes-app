export type OperationalErrorCode =
  | "unavailable"
  | "permission-denied"
  | "conflict"
  | "validation"
  | "not-found"
  | "unknown";

/** A stable failure vocabulary shared by use cases and presentation. */
export class OperationalError extends Error {
  readonly detail: string;

  constructor(
    readonly code: OperationalErrorCode,
    readonly operation: string,
    readonly retryable: boolean,
    detail: string,
    options: { cause?: unknown } = {},
  ) {
    super(`${operation}: ${detail}`, options);
    this.name = "OperationalError";
    this.detail = detail;
  }
}

export function toOperationalError(
  reason: unknown,
  operation: string,
): OperationalError {
  if (reason instanceof OperationalError) return reason;
  const detail = errorDetail(reason);
  const providerCode = providerErrorCode(reason);
  const code = classifyError(providerCode, detail);
  return new OperationalError(code, operation, isRetryable(code), detail, {
    cause: reason,
  });
}

function classifyError(
  providerCode: string | undefined,
  detail: string,
): OperationalErrorCode {
  const value = `${providerCode ?? ""} ${detail}`;
  if (/conflict|revision|changed[_ ]elsewhere|precondition/i.test(value))
    return "conflict";
  if (/permission|authori[sz]|denied|forbidden|unauthenticated/i.test(value))
    return "permission-denied";
  if (/validation|invalid|required|malformed|schema/i.test(value))
    return "validation";
  if (/not[_ -]?found|missing record/i.test(value)) return "not-found";
  if (
    /offline|network|fetch|unavailable|connection|timeout|interrupted|storage/i.test(
      value,
    )
  )
    return "unavailable";
  return "unknown";
}

function isRetryable(code: OperationalErrorCode): boolean {
  return code === "unavailable" || code === "conflict" || code === "unknown";
}

function providerErrorCode(reason: unknown): string | undefined {
  if (!reason || typeof reason !== "object" || !("code" in reason)) return;
  const code = reason.code;
  return typeof code === "string" ? code : undefined;
}

function errorDetail(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

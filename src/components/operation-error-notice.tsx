import { t } from "@lingui/core/macro";
import { useLingui, Trans } from "@lingui/react/macro";
import { cleanOperationError } from "../app/operation-error";
import {
  toOperationalError,
  type OperationalError,
} from "../application/operational-error";

export function OperationErrorNotice({
  action,
  message,
  recovery,
  className = "",
}: {
  action: string;
  message: string | OperationalError;
  recovery: string;
  className?: string;
}) {
  const { t } = useLingui();
  const failure =
    typeof message === "string" ? toOperationalError(message, action) : message;
  const technical = cleanOperationError(failure.detail).trim();
  return (
    <div className={`operation-error ${className}`.trim()}>
      <p className="inline-error" role="alert">
        {operationErrorSummary(action, failure.code)}{" "}
        {failure.code === "outcome-unknown"
          ? t({
              message:
                "Keep the collection connected and review the earlier change’s exact result before making another change.",
            })
          : recovery}
      </p>
      {technical ? (
        <details className="operation-error-details">
          <summary>
            <Trans>Technical details</Trans>
          </summary>
          <p>{technical}</p>
        </details>
      ) : null}
    </div>
  );
}

function operationErrorSummary(
  action: string,
  code: OperationalError["code"],
): string {
  switch (code) {
    case "unavailable":
      return t`${action} could not finish while the collection was unavailable.`;
    case "outcome-unknown":
      return t`${action} may have been saved, but its result could not be confirmed.`;
    case "cancelled":
      return t`${action} was cancelled.`;
    case "permission-denied":
      return t`${action} needs access to the collection.`;
    case "conflict":
      return t`${action} could not finish because the task changed elsewhere.`;
    case "validation":
      return t`${action} contains a value the collection cannot accept.`;
    case "not-found":
      return t`${action} could not finish because the record no longer exists.`;
    default:
      return t`${action} could not finish.`;
  }
}

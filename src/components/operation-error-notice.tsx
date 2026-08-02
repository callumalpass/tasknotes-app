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
  const failure =
    typeof message === "string" ? toOperationalError(message, action) : message;
  const technical = cleanOperationError(failure.detail).trim();
  return (
    <div className={`operation-error ${className}`.trim()}>
      <p className="inline-error" role="alert">
        {operationErrorSummary(action, failure.code)} {recovery}
      </p>
      {technical ? (
        <details className="operation-error-details">
          <summary>Technical details</summary>
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
      return `${action} could not finish while the collection was unavailable.`;
    case "permission-denied":
      return `${action} needs access to the collection.`;
    case "conflict":
      return `${action} could not finish because the task changed elsewhere.`;
    case "validation":
      return `${action} contains a value the collection cannot accept.`;
    case "not-found":
      return `${action} could not finish because the record no longer exists.`;
    default:
      return `${action} could not finish.`;
  }
}

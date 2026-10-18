import { useContext } from "react";
import { ConnectionNoticeContext } from "../app/connection-notice";
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
  const waiting =
    useContext(ConnectionNoticeContext) === "waiting_for_computer";
  if (waiting && failure.code === "unavailable")
    return (
      <p role="status">
        Waiting for your computer. Try this action again when it reconnects.
      </p>
    );
  const technical = cleanOperationError(failure.detail).trim();
  return (
    <div className={`operation-error ${className}`.trim()}>
      <p className="inline-error" role="alert">
        {operationErrorSummary(action, failure.code)}{" "}
        {failure.code === "outcome-unknown"
          ? "TaskNotes keeps checking automatically while the collection is connected. You can keep working."
          : recovery}
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
    case "outcome-unknown":
      return `${action} may have been saved; TaskNotes is still confirming it.`;
    case "cancelled":
      return `${action} was cancelled.`;
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

import { useLingui as useI18n } from "@lingui/react";
import { t } from "@lingui/core/macro";

import { Trans } from "@lingui/react/macro";
import { t as translate } from "@lingui/core/macro";
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
  useI18n();
  const failure =
    typeof message === "string" ? toOperationalError(message, action) : message;
  const waiting =
    useContext(ConnectionNoticeContext) === "waiting_for_computer";
  if (waiting && failure.code === "unavailable")
    return (
      <p role="status">
        <Trans>
          Waiting for your computer. Try this action again when it reconnects.
        </Trans>
      </p>
    );
  const technical = cleanOperationError(failure.detail).trim();
  return (
    <div className={`operation-error ${className}`.trim()}>
      <p className="inline-error" role="alert">
        {operationErrorSummary(action, failure.code)}{" "}
        {failure.code === "outcome-unknown"
          ? translate({
              message:
                "TaskNotes keeps checking automatically while the collection is connected. You can keep working.",
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
      return `${action} may have been saved; TaskNotes is still confirming it.`;
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

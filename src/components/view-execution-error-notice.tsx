import { useLingui, Trans } from "@lingui/react/macro";
import { cleanOperationError } from "../app/operation-error";
import { toOperationalError } from "../application/operational-error";
import { connectProblemFromError } from "../application/connect-problem";

export function ViewExecutionErrorNotice({
  reason,
  canEdit,
  onEdit,
  onRetry,
}: {
  reason: unknown;
  canEdit: boolean;
  onEdit(): void;
  onRetry(): void;
}) {
  const { t } = useLingui();
  const failure = toOperationalError(reason, t({ message: "This view" }));
  const incompatible = isComputedQueryFailure(reason);
  const technical = cleanOperationError(failure.detail).trim();

  return (
    <div className="view-execution-error" role="alert">
      <details>
        <summary>
          {incompatible
            ? t({ message: "This view uses an unavailable sort." })
            : t({ message: "This view couldn’t load." })}
        </summary>
        <div className="view-execution-error-body">
          <p>
            {incompatible
              ? t({
                  message:
                    "A computed value is being used to sort this view. This collection cannot order results by computed values yet. Choose a stored property instead.",
                })
              : t({
                  message:
                    "Try loading the view again. If the problem continues, edit its settings or choose another view.",
                })}
          </p>
          <div className="view-execution-error-actions">
            {canEdit ? (
              <button className="outline-action" type="button" onClick={onEdit}>
                <Trans>Edit view</Trans>
              </button>
            ) : null}
            <button className="outline-action" type="button" onClick={onRetry}>
              <Trans>Try again</Trans>
            </button>
          </div>
          {technical ? (
            <p className="view-execution-error-technical">
              <strong>
                <Trans>Technical details</Trans>
              </strong>
              <span>{technical}</span>
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function isComputedQueryFailure(reason: unknown): boolean {
  return connectProblemFromError(reason)?.reason === "unsupported_hosted_order";
}

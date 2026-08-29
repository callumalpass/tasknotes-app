import { cleanOperationError } from "../app/operation-error";
import { toOperationalError } from "../application/operational-error";
import { connectProblemFromError } from "../cloud/outcome";

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
  const failure = toOperationalError(reason, "This view");
  const incompatible = isComputedQueryFailure(reason);
  const technical = cleanOperationError(failure.detail).trim();

  return (
    <div className="view-execution-error" role="alert">
      <details>
        <summary>
          {incompatible
            ? "This view uses an unavailable sort."
            : "This view couldn’t load."}
        </summary>
        <div className="view-execution-error-body">
          <p>
            {incompatible
              ? "A computed value is being used to sort this view. This collection cannot order results by computed values yet. Choose a stored property instead."
              : "Try loading the view again. If the problem continues, edit its settings or choose another view."}
          </p>
          <div className="view-execution-error-actions">
            {canEdit ? (
              <button className="outline-action" type="button" onClick={onEdit}>
                Edit view
              </button>
            ) : null}
            <button className="outline-action" type="button" onClick={onRetry}>
              Try again
            </button>
          </div>
          {technical ? (
            <p className="view-execution-error-technical">
              <strong>Technical details</strong>
              <span>{technical}</span>
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function isComputedQueryFailure(reason: unknown): boolean {
  const problem = connectProblemFromError(reason);
  if (!problem) return false;
  const details = object(problem.details);
  const codes = [
    problem.code,
    stringProperty(problem, "server_code"),
    stringProperty(details, "semantic_code"),
  ];
  return codes.some((code) => code === "unsupported_hosted_order");
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringProperty(value: object | null, key: string): string | undefined {
  if (!value || !(key in value)) return;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : undefined;
}

import type { MdbaseErrorDescription } from "@mdbase-dev/sdk";

/** Copy and suggestions only. The original SDK owner supplies any action.
 * An action label is shown only as a working control, never as plain text. */
export function ApplicationProblemNotice({
  description,
  message = description.message,
  summary,
  onAction,
  busy = false,
  alert = false,
}: {
  description: MdbaseErrorDescription;
  message?: string;
  summary?: string;
  onAction?: () => void;
  busy?: boolean;
  alert?: boolean;
}) {
  return (
    <div
      className={
        description.severity === "info" && !alert
          ? "connection-status"
          : "connection-error"
      }
      role={!alert && description.severity === "info" ? "status" : "alert"}
    >
      <p>
        <strong>{description.title}</strong>
      </p>
      {summary ? <p>{summary}</p> : null}
      <p>{message}</p>
      {description.actionLabel ? (
        description.updateUrl ? (
          <a
            href={description.updateUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {description.actionLabel}
          </a>
        ) : onAction ? (
          <button
            className="text-action"
            type="button"
            disabled={busy}
            onClick={onAction}
          >
            {description.actionLabel}
          </button>
        ) : null
      ) : null}
    </div>
  );
}

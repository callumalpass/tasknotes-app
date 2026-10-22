import type { Ref } from "react";
import type { RecordWriteRejection } from "../application/ports/task-repository";
import "./held-edits.css";

/** An in-editor choice for a refused save. The draft stays on screen until the
 * person keeps it (re-applied on the latest version) or loads the latest. */
export function WriteRejectionNotice({
  rejection,
  busy,
  error,
  onKeep,
  onDiscard,
  ref,
}: {
  rejection: RecordWriteRejection;
  busy: boolean;
  error: string | null;
  onKeep(): void;
  onDiscard(): void;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      className="collection-held-notice write-rejection-notice"
      role="alert"
      tabIndex={-1}
      aria-label="Edit not saved"
    >
      <div>
        <strong>
          {rejection.changedElsewhere
            ? "This task changed somewhere else, so your edit wasn't saved."
            : "Your edit wasn't saved."}
        </strong>
        <p>
          {rejection.changedElsewhere
            ? "Keep your edit to apply it on top of the latest version, or discard it and load the latest version."
            : rejection.message}
        </p>
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="held-edit-actions">
        {rejection.changedElsewhere ? (
          <button
            className="text-action"
            disabled={busy}
            type="button"
            onClick={onKeep}
          >
            Keep my edit
          </button>
        ) : null}
        <button
          className="text-action"
          disabled={busy}
          type="button"
          onClick={onDiscard}
        >
          {rejection.changedElsewhere
            ? "Discard and load latest"
            : "Discard my edit"}
        </button>
      </div>
    </div>
  );
}

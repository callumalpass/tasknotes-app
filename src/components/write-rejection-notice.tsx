import { Trans } from "@lingui/react/macro";
import { t as translate } from "@lingui/core/macro";
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
      aria-label={translate({ message: "Edit not saved" })}
    >
      <div>
        <strong>
          {rejection.changedElsewhere
            ? translate({
                message:
                  "This task changed somewhere else, so your edit wasn't saved.",
              })
            : translate({ message: "Your edit wasn't saved." })}
        </strong>
        <p>
          {rejection.changedElsewhere
            ? translate({
                message:
                  "Keep your edit to apply it on top of the latest version, or discard it and load the latest version.",
              })
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
            <Trans>Keep my edit</Trans>
          </button>
        ) : null}
        <button
          className="text-action"
          disabled={busy}
          type="button"
          onClick={onDiscard}
        >
          {rejection.changedElsewhere
            ? translate({ message: "Discard and load latest" })
            : translate({ message: "Discard my edit" })}
        </button>
      </div>
    </div>
  );
}

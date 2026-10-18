import { useEffect, useRef, useState } from "react";
import {
  migratingRetryDelayMs,
  type CutoverProblem,
} from "../application/cutover-problem";
import { BACKOFF_RESET_MS, migratingBackoff } from "./migrating-backoff";
import { appPlatform } from "../native/app-platform";
import { saveBeforeReload } from "../pwa/reload";

export interface CutoverActions {
  isNative(): boolean;
  openExternalUrl(url: string): Promise<void>;
  saveBeforeReload(): Promise<void>;
  reload(): void;
}

const defaultActions: CutoverActions = {
  isNative: () => appPlatform.isNative(),
  openExternalUrl: (url) => appPlatform.openExternalUrl(url),
  saveBeforeReload,
  reload: () => window.location.reload(),
};

/**
 * Explains a sync-service cutover refusal using the server's own message.
 * `retry` is the caller's existing retry; it is offered only where it can
 * still help, and runs automatically with backoff while a collection moves.
 */
export function CutoverNotice({
  problem,
  retry,
  retryLabel,
  autoRetry = false,
  actions = defaultActions,
  className = "",
}: {
  problem: CutoverProblem;
  retry?: () => void;
  retryLabel?: string;
  /** Retry automatically while migrating. Use only on full-screen states. */
  autoRetry?: boolean;
  actions?: CutoverActions;
  className?: string;
}) {
  const native = actions.isNative();
  const canUpdate =
    problem.kind === "update" && (native ? Boolean(problem.updateUrl) : true);
  // Retry cannot succeed once the collection needs a newer app.
  const showRetry = Boolean(retry) && (problem.kind !== "update" || !canUpdate);
  const nextCheck = useMigratingAutoRetry(
    autoRetry && problem.kind === "migrating" ? retry : undefined,
    problem.retryAfterSeconds,
  );
  const [updating, setUpdating] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const update = () => {
    if (updating) return;
    if (native) {
      if (problem.updateUrl)
        void actions.openExternalUrl(problem.updateUrl).catch(() => undefined);
      return;
    }
    // On the web the update is a reload. Save open drafts first; if they
    // cannot be saved, keep the page open and say why.
    setUpdating(true);
    setSaveError(null);
    void actions
      .saveBeforeReload()
      .then(() => actions.reload())
      .catch((reason: unknown) => {
        setSaveError(
          reason instanceof Error && reason.message
            ? reason.message
            : "Your changes could not be saved.",
        );
        setUpdating(false);
      });
  };

  return (
    <div
      className={`cutover-notice cutover-${problem.kind} ${className}`.trim()}
      data-cutover-code={problem.code}
    >
      <p
        className="cutover-message"
        role={problem.kind === "migrating" ? "status" : "alert"}
      >
        {problem.message}
      </p>
      {problem.kind === "migrating" ? (
        <p className="cutover-hint">
          {nextCheck
            ? "TaskNotes will keep checking and continue when the upgrade is done. Anything open on this page stays here."
            : "Anything open on this page stays here. Try again in a few minutes."}
        </p>
      ) : null}
      {saveError ? (
        <div className="cutover-save-error" role="alert">
          <p>{saveError}</p>
          <p>
            Copy anything you still need, then reload. Unsaved changes on this
            page will be lost.
          </p>
        </div>
      ) : null}
      <div className="cutover-actions">
        {canUpdate ? (
          <button
            className="primary-action"
            disabled={updating}
            onClick={update}
            type="button"
          >
            {updating ? "Saving changes…" : "Update TaskNotes"}
          </button>
        ) : null}
        {saveError ? (
          <button
            className="secondary-action"
            onClick={() => actions.reload()}
            type="button"
          >
            Reload anyway
          </button>
        ) : null}
        {problem.kind === "suspended" && problem.supportUrl ? (
          <button
            className="secondary-action"
            onClick={() =>
              void actions
                .openExternalUrl(problem.supportUrl!)
                .catch(() => undefined)
            }
            type="button"
          >
            Contact support
          </button>
        ) : null}
        {showRetry ? (
          <button
            className="secondary-action"
            onClick={() => retry?.()}
            type="button"
          >
            {problem.kind === "migrating"
              ? "Check now"
              : (retryLabel ?? "Try again")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Calls `retry` on a backoff schedule while mounted. Returns whether a check is scheduled. */
function useMigratingAutoRetry(
  retry: (() => void) | undefined,
  retryAfterSeconds: number | null,
): boolean {
  const retryRef = useRef(retry);
  useEffect(() => {
    retryRef.current = retry;
  });
  const enabled = Boolean(retry);
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const schedule = () => {
      if (Date.now() - migratingBackoff.lastCheckAt > BACKOFF_RESET_MS)
        migratingBackoff.attempt = 0;
      timer = window.setTimeout(
        () => {
          migratingBackoff.attempt += 1;
          migratingBackoff.lastCheckAt = Date.now();
          retryRef.current?.();
          schedule();
        },
        migratingRetryDelayMs(migratingBackoff.attempt, retryAfterSeconds),
      );
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [enabled, retryAfterSeconds]);
  return enabled;
}

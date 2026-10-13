import { X } from "lucide-react";
import { FeedbackNotice } from "./workspace-feedback";
import { useEffect, useRef, useState } from "react";

import type { TaskCompletion } from "./task-completion-motion";

const NOTICE_MS = 6000;

export function TaskCompletedNotice({
  completion,
  aboveMobileControls,
  onUndo,
  onDismiss,
}: {
  completion?: TaskCompletion;
  aboveMobileControls: boolean;
  onUndo(completion: TaskCompletion): Promise<unknown>;
  onDismiss(): void;
}) {
  const [undoing, setUndoing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [held, setHeld] = useState(false);
  const toast = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(completion);
  if (shown !== completion) {
    setShown(completion);
    setUndoing(false);
    setFailed(false);
    setHeld(false);
  }
  // The notice leaves on its own, but never while someone is reaching for it.
  useEffect(() => {
    if (!completion || held || undoing || failed) return;
    const timeout = window.setTimeout(onDismiss, NOTICE_MS);
    return () => window.clearTimeout(timeout);
  }, [completion, held, undoing, failed, onDismiss]);
  const message = completion
    ? failed
      ? `Couldn’t reopen “${completion.task.title}”`
      : `Completed “${completion.task.title}”`
    : "";
  return (
    <FeedbackNotice>
      <span role="status" className="visually-hidden">
        {message}
      </span>
      {completion ? (
        <div
          className={`undo-toast task-completed-notice${aboveMobileControls ? " is-above-mobile-controls" : ""}`}
          ref={toast}
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() =>
            setHeld(Boolean(toast.current?.contains(document.activeElement)))
          }
          onFocus={() => setHeld(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setHeld(false);
          }}
        >
          <span>{message}</span>
          <button
            type="button"
            disabled={undoing}
            onClick={async () => {
              setUndoing(true);
              setFailed(false);
              try {
                await onUndo(completion);
                onDismiss();
              } catch {
                setFailed(true);
              } finally {
                setUndoing(false);
              }
            }}
          >
            {failed ? "Try again" : "Undo"}
          </button>
          <button
            type="button"
            aria-label="Dismiss completion notice"
            onClick={onDismiss}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
      ) : null}
    </FeedbackNotice>
  );
}

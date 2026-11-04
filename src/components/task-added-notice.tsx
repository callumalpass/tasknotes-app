import { useLingui as useI18n } from "@lingui/react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { FeedbackNotice } from "./workspace-feedback";
import type { TaskSummary } from "../domain/task";
import type { TaskRepository } from "../application/ports/task-repository";
import { RecordWriteNotice } from "./record-write-notice";
import { useRecordWriteState } from "./use-record-write-state";

const NOTICE_MS = 15000;

export function TaskAddedNotice({
  task,
  onOpen,
  onDismiss,
  aboveMobileControls,
  repository,
  onUndo,
}: {
  task?: TaskSummary;
  repository?: TaskRepository;
  onOpen(task: TaskSummary): void;
  onDismiss(): void;
  onUndo?(task: TaskSummary): Promise<void>;
  aboveMobileControls: boolean;
}) {
  useI18n();
  const [undoing, setUndoing] = useState(false);
  const [undoFailed, setUndoFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  const [shown, setShown] = useState(task);
  if (shown !== task) {
    setShown(task);
    setUndoing(false);
    setUndoFailed(false);
    setHovered(false);
    setFocused(false);
  }
  const state = useRecordWriteState(repository, {
    kind: "task",
    id: task?.id ?? "",
  });
  const settled = task && !undoing && !undoFailed && state !== "failed";
  useEffect(() => {
    if (!settled || held) return;
    const timeout = window.setTimeout(onDismiss, NOTICE_MS);
    return () => window.clearTimeout(timeout);
  }, [settled, held, task, onDismiss]);
  const message = undoFailed
    ? t({ message: "Couldn’t undo. Try again." })
    : task
      ? state === "failed"
        ? t`Change rejected: ${task.title}`
        : t`Task added: ${task.title}`
      : "";
  return (
    <FeedbackNotice>
      <span role="status" className="visually-hidden">
        {message}
      </span>
      {task ? (
        <div
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onFocus={() => setFocused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setFocused(false);
          }}
          className={`undo-toast task-added-notice${aboveMobileControls ? " is-above-mobile-controls" : ""}`}
        >
          <span>{message}</span>
          {repository ? (
            <RecordWriteNotice
              repository={repository}
              target={{ kind: "task", id: task.id }}
            />
          ) : null}
          {onUndo && state === undefined ? (
            <button
              type="button"
              disabled={undoing}
              onClick={async () => {
                setUndoing(true);
                setUndoFailed(false);
                try {
                  await onUndo(task);
                  onDismiss();
                } catch {
                  setUndoFailed(true);
                } finally {
                  setUndoing(false);
                }
              }}
            >
              <Trans>Undo</Trans>
            </button>
          ) : null}
          {state !== "failed" ? (
            <button
              type="button"
              onClick={() => {
                onDismiss();
                onOpen(task);
              }}
            >
              <Trans>Open</Trans>
            </button>
          ) : null}
          <button
            type="button"
            aria-label={t({ message: "Dismiss task added confirmation" })}
            onClick={() => {
              onDismiss();
              document
                .getElementById("main-content")
                ?.focus({ preventScroll: true });
            }}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
      ) : null}
    </FeedbackNotice>
  );
}

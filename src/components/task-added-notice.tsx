import { useLingui, Trans } from "@lingui/react/macro";
import { X } from "lucide-react";
import type { TaskSummary } from "../domain/task";

export function TaskAddedNotice({
  task,
  onOpen,
  onDismiss,
  aboveMobileControls,
}: {
  task?: TaskSummary;
  onOpen(task: TaskSummary): void;
  onDismiss(): void;
  aboveMobileControls: boolean;
}) {
  const { t } = useLingui();
  return (
    <>
      <span role="status" className="visually-hidden">
        {task ? t`Task added: ${task.title}` : ""}
      </span>
      {task ? (
        <div
          className={`undo-toast task-added-notice${aboveMobileControls ? " is-above-mobile-controls" : ""}`}
        >
          <span>
            <Trans>Task added: {task.title}</Trans>
          </span>
          <button
            type="button"
            onClick={() => {
              onDismiss();
              onOpen(task);
            }}
          >
            <Trans>Open</Trans>
          </button>
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
    </>
  );
}

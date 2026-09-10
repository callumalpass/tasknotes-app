import { X } from "lucide-react";
import type { Task } from "../domain/task";

export function TaskAddedNotice({
  task,
  onOpen,
  onDismiss,
  aboveMobileControls,
}: {
  task?: Task;
  onOpen(task: Task): void;
  onDismiss(): void;
  aboveMobileControls: boolean;
}) {
  return (
    <>
      <span role="status" className="visually-hidden">
        {task ? `Task added: ${task.title}` : ""}
      </span>
      {task ? (
        <div
          className={`undo-toast task-added-notice${aboveMobileControls ? " is-above-mobile-controls" : ""}`}
        >
          <span>Task added: {task.title}</span>
          <button
            type="button"
            onClick={() => {
              onDismiss();
              onOpen(task);
            }}
          >
            Open
          </button>
          <button
            type="button"
            aria-label="Dismiss task added confirmation"
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

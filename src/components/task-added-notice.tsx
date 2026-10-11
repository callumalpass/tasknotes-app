import { X } from "lucide-react";
import type { TaskSummary } from "../domain/task";
import type { TaskRepository } from "../application/ports/task-repository";
import { RecordWriteNotice } from "./record-write-notice";
import { useRecordWriteState } from "./use-record-write-state";

export function TaskAddedNotice({
  task,
  onOpen,
  onDismiss,
  aboveMobileControls,
  repository,
}: {
  task?: TaskSummary;
  repository?: TaskRepository;
  onOpen(task: TaskSummary): void;
  onDismiss(): void;
  aboveMobileControls: boolean;
}) {
  const state = useRecordWriteState(repository, {
    kind: "task",
    id: task?.id ?? "",
  });
  const message = task
    ? `${state === "failed" ? "Change rejected" : "Task added"}: ${task.title}`
    : "";
  return (
    <>
      <span role="status" className="visually-hidden">
        {message}
      </span>
      {task ? (
        <div
          className={`undo-toast task-added-notice${aboveMobileControls ? " is-above-mobile-controls" : ""}`}
        >
          <span>{message}</span>
          {repository ? (
            <RecordWriteNotice
              repository={repository}
              target={{ kind: "task", id: task.id }}
            />
          ) : null}
          {state !== "failed" ? (
            <button
              type="button"
              onClick={() => {
                onDismiss();
                onOpen(task);
              }}
            >
              Open
            </button>
          ) : null}
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

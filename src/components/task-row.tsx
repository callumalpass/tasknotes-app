import { Square } from "lucide-react";

import { activeTimeEntry, taskMeta } from "../domain/task";
import { occurrenceTask } from "../domain/task-occurrence";
import { actionFeedback } from "../native/feedback";
import { TaskActions } from "./task-actions";

import type { Task } from "../domain/task";
import type { TaskOccurrence } from "../domain/task-occurrence";

export function TaskRow({
  task,
  onOpen,
  onToggle,
  details,
  occurrence,
}: {
  task: Task;
  onOpen(task: Task, occurrenceDate?: string): void;
  onToggle(task: Task, occurrenceDate?: string): void;
  details?: TaskRowDetail[];
  occurrence?: TaskOccurrence;
}) {
  const displayedTask = occurrence ? occurrenceTask(occurrence) : task;
  const metadata = taskMeta(displayedTask);
  const tracking = Boolean(activeTimeEntry(task.timeEntries));
  return (
    <div
      className={`task-row${displayedTask.completed ? " is-complete" : ""}${tracking ? " is-tracking" : ""}`}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest(".task-actions-trigger"))
          return;
        const trigger = event.currentTarget.querySelector<HTMLButtonElement>(
          ".task-actions-trigger",
        );
        if (!trigger) return;
        event.preventDefault();
        event.stopPropagation();
        trigger.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            clientX: event.clientX,
            clientY: event.clientY,
          }),
        );
      }}
    >
      <button
        className="completion-control"
        type="button"
        aria-label={`${displayedTask.completed ? "Reopen" : "Complete"} ${task.title}`}
        aria-pressed={displayedTask.completed}
        onClick={() => {
          actionFeedback();
          onToggle(task, occurrence?.date);
        }}
      >
        <span aria-hidden="true" />
      </button>
      <button
        className="task-row-content"
        type="button"
        onClick={() => onOpen(task, occurrence?.date)}
      >
        <span className="task-row-title">{task.title}</span>
        {details ? (
          tracking || details.length ? (
            <span className="task-row-properties">
              {tracking ? <TrackingIndicator /> : null}
              {details.map((detail) => (
                <span
                  className="task-row-property"
                  key={detail.key}
                  title={detail.description}
                >
                  <span>{detail.label}</span>
                  <strong>{detail.value}</strong>
                </span>
              ))}
            </span>
          ) : null
        ) : tracking || metadata.length ? (
          <span className="task-row-meta">
            {tracking ? <TrackingIndicator /> : null}
            {metadata.map((item) => (
              <span
                className={item.overdue ? "is-overdue" : undefined}
                key={item.label}
              >
                {item.label}
              </span>
            ))}
          </span>
        ) : null}
      </button>
      <TaskActions
        task={task}
        occurrenceDate={occurrence?.date}
        onOpen={onOpen}
        onToggle={onToggle}
      />
    </div>
  );
}

function TrackingIndicator() {
  return (
    <span className="task-row-tracking">
      <Square aria-hidden="true" fill="currentColor" size={8} strokeWidth={0} />
      Timer running
    </span>
  );
}

export interface TaskRowDetail {
  key: string;
  label: string;
  value: string;
  description?: string;
}

import { taskMeta } from "../domain/task";
import { occurrenceTask } from "../domain/task-occurrence";
import { actionFeedback } from "../native/feedback";

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
  return (
    <div className={`task-row${displayedTask.completed ? " is-complete" : ""}`}>
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
          details.length ? (
            <span className="task-row-properties">
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
        ) : metadata.length ? (
          <span className="task-row-meta">
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
    </div>
  );
}

export interface TaskRowDetail {
  key: string;
  label: string;
  value: string;
  description?: string;
}

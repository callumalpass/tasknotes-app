import { Haptics, ImpactStyle } from "@capacitor/haptics";

import { taskMeta } from "../domain/task";

import type { Task } from "../domain/task";

export function TaskRow({
  task,
  onOpen,
  onToggle,
  details,
}: {
  task: Task;
  onOpen(task: Task): void;
  onToggle(task: Task): void;
  details?: TaskRowDetail[];
}) {
  const metadata = taskMeta(task);
  return (
    <div className={`task-row${task.completed ? " is-complete" : ""}`}>
      <button
        className="completion-control"
        type="button"
        aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
        aria-pressed={task.completed}
        onClick={() => {
          void Haptics.impact({ style: ImpactStyle.Light }).catch(
            () => undefined,
          );
          onToggle(task);
        }}
      >
        <span aria-hidden="true" />
      </button>
      <button
        className="task-row-content"
        type="button"
        onClick={() => onOpen(task)}
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

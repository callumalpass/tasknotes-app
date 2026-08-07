import { Square } from "lucide-react";
import { useRef, useState } from "react";

import { activeTimeEntry, taskMeta } from "../domain/task";
import { occurrenceTask } from "../domain/task-occurrence";
import { actionFeedback } from "../native/feedback";
import { TaskActions } from "./task-actions";
import { TaskPropertyEditor } from "./task-property-editor";

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
  const [editing, setEditing] = useState<TaskRowDetail | null>(null);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const shownDetails = details ?? defaultTaskDetails(displayedTask, metadata);
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
      <div className="task-row-content">
        <button
          className="task-row-title"
          title={task.title}
          type="button"
          onClick={() => onOpen(task, occurrence?.date)}
        >
          {task.title}
        </button>
        {details ? (
          tracking || shownDetails.length ? (
            <span className="task-row-properties">
              {tracking ? <TrackingIndicator /> : null}
              {shownDetails.map((detail) => (
                <button
                  className="task-row-property"
                  key={detail.key}
                  title={detail.description}
                  type="button"
                  onClick={(event) => {
                    editorTrigger.current = event.currentTarget;
                    setEditing(detail);
                  }}
                >
                  <span>{detail.label}</span>
                  <strong>{detail.value}</strong>
                </button>
              ))}
            </span>
          ) : null
        ) : tracking || shownDetails.length ? (
          <span className="task-row-meta">
            {tracking ? <TrackingIndicator /> : null}
            {shownDetails.map((detail) => (
              <button
                className={detail.overdue ? "is-overdue" : undefined}
                key={detail.key}
                type="button"
                onClick={(event) => {
                  editorTrigger.current = event.currentTarget;
                  setEditing(detail);
                }}
              >
                {detail.value}
              </button>
            ))}
          </span>
        ) : null}
      </div>
      <TaskActions
        task={task}
        occurrenceDate={occurrence?.date}
        onOpen={onOpen}
        onToggle={onToggle}
      />
      {editing ? (
        <TaskPropertyEditor
          detail={editing}
          occurrenceDate={occurrence?.date}
          task={task}
          onClose={() => {
            setEditing(null);
            window.requestAnimationFrame(() => editorTrigger.current?.focus());
          }}
        />
      ) : null}
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
  rawValue?: unknown;
  description?: string;
  overdue?: boolean;
}

function defaultTaskDetails(
  task: Task,
  metadata: ReturnType<typeof taskMeta>,
): TaskRowDetail[] {
  let index = 0;
  const details: TaskRowDetail[] = [];
  if (task.scheduled)
    details.push({
      key: "scheduled",
      label: "Scheduled",
      value: metadata[index++]?.label ?? task.scheduled,
      rawValue: task.scheduled,
      overdue: metadata[index - 1]?.overdue,
    });
  else if (task.due)
    details.push({
      key: "due",
      label: "Due",
      value: metadata[index++]?.label ?? task.due,
      rawValue: task.due,
      overdue: metadata[index - 1]?.overdue,
    });
  if (task.priority !== "none" && task.priority !== "normal")
    details.push({
      key: "priority",
      label: "Priority",
      value: metadata[index++]?.label ?? task.priority,
      rawValue: task.priority,
    });
  if (task.recurrence)
    details.push({
      key: "recurrence",
      label: "Repeat",
      value: metadata[index]?.label ?? task.recurrence,
      rawValue: task.recurrence,
    });
  return details;
}

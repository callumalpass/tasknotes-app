import { taskMeta } from "../i18n/presentation";
import { t } from "@lingui/core/macro";
import { useLingui, Trans } from "@lingui/react/macro";
import { Square } from "lucide-react";
import { completionKey } from "../application/task-mutations";
import { useMutationState } from "./use-mutation-state";
import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { activeTimeEntry } from "../domain/task";
import { relativeDateDetail } from "../i18n/view-presentation";
import { occurrenceTask } from "../domain/task-occurrence";
import { actionFeedback, successFeedback } from "../native/feedback";
import { useRepository } from "../app/repository-context";
import { RecordWriteNotice } from "./record-write-notice";
import { TaskActions } from "./task-actions";
import { TaskPropertyEditor } from "./task-property-editor";
import { useSwipeActions } from "./use-swipe-actions";
import { useTaskShortcuts } from "./use-task-shortcuts";
import { preserveRowFocus } from "../app/keyboard-shortcuts";
import {
  COMPLETION_FOLD_MS,
  COMPLETION_LINGER_MS,
  TaskCompletionReportContext,
  TaskDeparturesContext,
  prefersReducedMotion,
  type TaskCompletion,
} from "./task-completion-motion";

import type { TaskSummary } from "../domain/task";
import type { TaskOccurrence } from "../domain/task-occurrence";

export function TaskRow({
  task,
  onOpen,
  onToggle,
  details,
  occurrence,
  supportingText,
}: {
  task: TaskSummary;
  onOpen(task: TaskSummary, occurrenceDate?: string): void;
  onToggle(task: TaskSummary, occurrenceDate?: string): void | Promise<unknown>;
  details?: TaskRowDetail[];
  occurrence?: TaskOccurrence;
  supportingText?: string;
}) {
  const { t } = useLingui();
  const supportingId = useId();
  const { configuration, mutations, repository, updateTask } = useRepository();
  const command = useMutationState(
    mutations,
    completionKey(task.id, occurrence?.date),
  );
  const pendingRef = useRef(false);
  const [localPending, setLocalPending] = useState(false);
  const [localError, setLocalError] = useState("");
  const pending = command.pending || localPending;
  const error = mutations ? command.error?.message : localError;
  const reportCompletion = useContext(TaskCompletionReportContext);
  // Only a completion made here animates; rows that load completed are still.
  const [justCompleted, setJustCompleted] = useState(false);
  async function complete(): Promise<boolean> {
    if (pendingRef.current || command.pending) return false;
    pendingRef.current = true;
    setLocalPending(true);
    setLocalError("");
    const completing = !displayedTask.completed;
    try {
      const saved = await onToggle(task, occurrence?.date);
      if (completing) {
        successFeedback();
        setJustCompleted(true);
        reportCompletion(completionRecord(task, occurrence?.date, saved));
      } else actionFeedback();
      return true;
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      pendingRef.current = false;
      setLocalPending(false);
    }
  }
  const displayedTask = occurrence ? occurrenceTask(occurrence) : task;
  const metadata = taskMeta(displayedTask);
  const status = configuration.statuses.find(
    (candidate) => candidate.value === displayedTask.status,
  );
  const distinctStatus =
    !displayedTask.completed &&
    Boolean(status) &&
    displayedTask.status !== configuration.defaults.status &&
    displayedTask.status !== "none";
  const statusColor = distinctStatus ? status?.color : undefined;
  const [seenCompleted, setSeenCompleted] = useState(displayedTask.completed);
  if (seenCompleted !== displayedTask.completed) {
    setSeenCompleted(displayedTask.completed);
    if (!displayedTask.completed) setJustCompleted(false);
  }
  const tracking = Boolean(activeTimeEntry(task.timeEntries));
  const [editing, setEditing] = useState<{
    detail: TaskRowDetail;
    anchor: TaskPropertyEditorAnchor;
  } | null>(null);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const shownDetails = (
    details ?? defaultTaskDetails(displayedTask, metadata, configuration)
  )
    .filter((detail) => {
      const field = detail.key.replace(/^note\./, "");
      if (field === configuration.fieldMapping.status || field === "status")
        return detail.rawValue !== configuration.defaults.status;
      if (field === configuration.fieldMapping.priority || field === "priority")
        return (
          detail.rawValue !== configuration.defaults.priority &&
          detail.rawValue !== "none"
        );
      if (field === "archived") return detail.rawValue !== false;
      return true;
    })
    .map((detail) => relativeDateDetail(detail, displayedTask, configuration));
  const rowRef = useRef<HTMLDivElement>(null);
  useCompletionDeparture(
    rowRef,
    useContext(TaskDeparturesContext).get(task.id),
  );
  useTaskShortcuts(rowRef, {
    task,
    completed: displayedTask.completed,
    reschedulable: !(occurrence && task.recurrence && !task.occurrenceDate),
    open: () => onOpen(task, occurrence?.date),
    toggle: async () => {
      if (!(await complete())) throw new Error("Completion failed");
    },
    schedule: async (scheduled) => {
      try {
        await updateTask(task.id, { scheduled });
        actionFeedback();
      } catch (reason) {
        setLocalError(
          reason instanceof Error ? reason.message : String(reason),
        );
        throw reason;
      }
    },
  });
  const swipe = useSwipeActions({
    disabled: pending,
    onSwipe: (direction) => {
      if (direction === "complete") void complete();
      else
        rowRef.current
          ?.querySelector<HTMLButtonElement>(".task-actions-trigger")
          ?.click();
    },
  });
  return (
    <div
      {...swipe.handlers}
      className={`task-row${displayedTask.completed ? " is-complete" : ""}${justCompleted && displayedTask.completed ? " is-just-completed" : ""}${tracking ? " is-tracking" : ""}${swipe.offset ? " is-swiping" : ""}${swipe.direction ? " is-swipe-ready" : ""}`}
      data-task-id={task.id}
      data-task-title={task.title}
      data-task-completed={displayedTask.completed ? "true" : undefined}
      data-occurrence={occurrence?.date}
      data-swipe-hint={
        swipe.offset > 0
          ? displayedTask.completed
            ? t({ message: "Reopen" })
            : t({ message: "Complete" })
          : swipe.offset < 0
            ? t({ message: "Actions" })
            : undefined
      }
      ref={rowRef}
      style={
        swipe.offset
          ? ({ "--swipe-x": `${swipe.offset}px` } as React.CSSProperties)
          : undefined
      }
      onClick={(event) => {
        const target = event.target as HTMLElement;
        // Portaled menus/editors bubble through React, but are not row space.
        if (
          !event.currentTarget.contains(target) ||
          target.closest(
            "button, a, input, textarea, select, [role='button'], [contenteditable]",
          )
        )
          return;
        event.currentTarget
          .querySelector<HTMLButtonElement>(".task-row-title")
          ?.focus({ preventScroll: true });
        onOpen(task, occurrence?.date);
      }}
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
        className={`completion-control${statusColor ? " has-status" : ""}`}
        type="button"
        aria-label={`${displayedTask.completed ? t({ message: "Reopen" }) : t({ message: "Complete" })} ${task.title}${distinctStatus ? `, ${status?.label ?? displayedTask.status}` : ""}`}
        aria-pressed={displayedTask.completed}
        aria-busy={pending}
        disabled={pending}
        title={distinctStatus ? status?.label : undefined}
        style={
          // The stored colour draws the ring; the label names the status.
          statusColor
            ? ({ "--status-color": statusColor } as React.CSSProperties)
            : undefined
        }
        onClick={() => void complete()}
      >
        <span aria-hidden="true" />
      </button>
      <div className="task-row-content">
        {error ? (
          <p className="task-row-error" role="alert">
            {error}{" "}
            <button
              type="button"
              disabled={pending}
              onClick={() => void complete()}
            >
              <Trans>Retry</Trans>
            </button>
          </p>
        ) : null}
        {command.warning ? <p role="status">{command.warning}</p> : null}
        <button
          className="task-row-title"
          aria-describedby={supportingText ? supportingId : undefined}
          title={task.title}
          type="button"
          onClick={() => onOpen(task, occurrence?.date)}
        >
          <span className="task-row-title-text">
            <span>{task.title}</span>
          </span>
        </button>
        {supportingText ? (
          <small id={supportingId} className="task-row-context">
            {supportingText}
          </small>
        ) : null}
        {details ? (
          tracking || shownDetails.length ? (
            <span className="task-row-properties">
              {tracking ? <TrackingIndicator /> : null}
              {shownDetails.map((detail) => (
                <button
                  className={`task-row-property${isCompactDetail(detail, configuration) ? " is-compact" : ""}${detail.overdue ? " is-overdue" : ""}`}
                  key={detail.key}
                  title={detail.description}
                  aria-label={`${detail.label}: ${detail.value}`}
                  type="button"
                  onClick={(event) => {
                    editorTrigger.current = event.currentTarget;
                    setEditing({
                      detail,
                      anchor: editorAnchor(event.currentTarget),
                    });
                  }}
                >
                  <span>{detail.label}</span>
                  <strong>
                    {detailPriorityColor(detail, configuration) ? (
                      <span
                        aria-hidden="true"
                        className="value-color"
                        style={{
                          backgroundColor: detailPriorityColor(
                            detail,
                            configuration,
                          ),
                        }}
                      />
                    ) : null}
                    {detail.value}
                  </strong>
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
                  setEditing({
                    detail,
                    anchor: editorAnchor(event.currentTarget),
                  });
                }}
              >
                {detailPriorityColor(detail, configuration) ? (
                  <span
                    aria-hidden="true"
                    className="value-color"
                    style={{
                      backgroundColor: detailPriorityColor(
                        detail,
                        configuration,
                      ),
                    }}
                  />
                ) : null}
                {isDateDetail(detail, configuration) ? `${detail.label} ` : ""}
                {detail.value}
              </button>
            ))}
          </span>
        ) : null}
        <RecordWriteNotice
          repository={repository}
          target={{ kind: "task", id: task.id }}
        />
      </div>
      <TaskActions
        task={task}
        occurrenceDate={occurrence?.date}
        onOpen={onOpen}
        onToggle={onToggle}
      />
      {editing ? (
        <TaskPropertyEditor
          anchor={editing.anchor}
          detail={editing.detail}
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

/**
 * A row the list retains after its task left the results lingers, then folds
 * its height away so the rows beneath close up rather than jump. Keyboard
 * focus moves on at once, so completing several tasks in a row stays quick.
 */
function useCompletionDeparture(
  rowRef: React.RefObject<HTMLDivElement | null>,
  acceptedAt: number | null | undefined,
) {
  const departing = acceptedAt !== undefined;
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!departing || !row) return;
    if (row.contains(document.activeElement)) {
      const restore = preserveRowFocus(row);
      (document.activeElement as HTMLElement | null)?.blur();
      row.inert = true;
      restore();
    } else row.inert = true;
    return () => {
      row.inert = false;
    };
  }, [departing, rowRef]);
  useEffect(() => {
    const row = rowRef.current;
    if (typeof acceptedAt !== "number" || !row || prefersReducedMotion())
      return;
    // Board cards and orderable rows fold their whole wrapper.
    const target =
      row.closest<HTMLElement>(".kanban-card, .manual-order-row") ?? row;
    if (typeof target.animate !== "function") return;
    const style = getComputedStyle(target);
    const fold = target.animate(
      [
        {
          height: `${target.getBoundingClientRect().height}px`,
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          minHeight: style.minHeight,
          overflow: "hidden",
          opacity: 1,
        },
        {
          height: "0px",
          paddingTop: "0px",
          paddingBottom: "0px",
          minHeight: "0px",
          overflow: "hidden",
          opacity: 0,
        },
      ],
      {
        delay: Math.max(0, acceptedAt + COMPLETION_LINGER_MS - Date.now()),
        duration: COMPLETION_FOLD_MS,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "both",
      },
    );
    return () => fold.cancel();
  }, [acceptedAt, rowRef]);
}

/**
 * What Undo needs to put back. A repeating task completed from its series row
 * records one instance (not necessarily today's) and may advance its dates.
 */
function completionRecord(
  task: TaskSummary,
  occurrenceDate: string | undefined,
  saved: unknown,
): TaskCompletion {
  if (occurrenceDate || !task.recurrence || !saved || typeof saved !== "object")
    return { task, occurrenceDate };
  const next = saved as Partial<TaskSummary>;
  const instance = next.completeInstances?.find(
    (date) => !task.completeInstances.includes(date),
  );
  const moved = next.scheduled !== task.scheduled || next.due !== task.due;
  return {
    task,
    occurrenceDate: instance,
    ...(moved
      ? {
          advanced: {
            scheduled: task.scheduled ?? null,
            due: task.due ?? null,
          },
        }
      : {}),
  };
}

export interface TaskPropertyEditorAnchor {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
}

function editorAnchor(element: HTMLElement): TaskPropertyEditorAnchor {
  const bounds = element.getBoundingClientRect();
  return {
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
    left: bounds.left,
    width: bounds.width,
  };
}

function TrackingIndicator() {
  return (
    <span className="task-row-tracking">
      <Square aria-hidden="true" fill="currentColor" size={8} strokeWidth={0} />
      <Trans>Timer running</Trans>
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

function detailPriorityColor(
  detail: TaskRowDetail,
  configuration: import("../domain/task-configuration").TaskCollectionConfiguration,
): string | undefined {
  if (typeof detail.rawValue !== "string") return undefined;
  const bracketed = /^note\[(?:"|')(.+)(?:"|')\]$/.exec(detail.key);
  const key = bracketed?.[1] ?? detail.key.replace(/^note\./, "");
  if (key !== configuration.fieldMapping.priority && key !== "priority")
    return undefined;
  return configuration.priorities.find(
    (option) => option.value === detail.rawValue,
  )?.color;
}

function isDateDetail(
  detail: TaskRowDetail,
  configuration: import("../domain/task-configuration").TaskCollectionConfiguration,
): boolean {
  const bracketed = /^note\[(?:"|')(.+)(?:"|')\]$/.exec(detail.key);
  const key = bracketed?.[1] ?? detail.key.replace(/^note\./, "");
  return [
    "scheduled",
    "due",
    configuration.fieldMapping.scheduled,
    configuration.fieldMapping.due,
  ].includes(key);
}

function isCompactDetail(
  detail: TaskRowDetail,
  configuration: import("../domain/task-configuration").TaskCollectionConfiguration,
): boolean {
  const bracketed = /^note\[(?:"|')(.+)(?:"|')\]$/.exec(detail.key);
  const key = bracketed?.[1] ?? detail.key.replace(/^note\./, "");
  return [
    configuration.fieldMapping.status,
    configuration.fieldMapping.priority,
    configuration.fieldMapping.projects,
    "status",
    "priority",
    "projects",
  ].includes(key);
}

function defaultTaskDetails(
  task: TaskSummary,
  metadata: ReturnType<typeof taskMeta>,
  configuration: import("../domain/task-configuration").TaskCollectionConfiguration,
): TaskRowDetail[] {
  let index = 0;
  const details: TaskRowDetail[] = [];
  if (task.scheduled) {
    index++;
    details.push({
      key: "scheduled",
      label: t({ message: "Scheduled" }),
      value: task.scheduled,
      rawValue: task.scheduled,
    });
  }
  if (task.due) {
    if (!task.scheduled) index++;
    details.push({
      key: "due",
      label: t({ message: "Due" }),
      value: task.due,
      rawValue: task.due,
    });
  }
  const priority = configuration.priorities.find(
    (option) => option.value === task.priority,
  );
  const defaultPriority = configuration.priorities.find(
    (option) => option.value === configuration.defaults.priority,
  );
  if (
    task.priority !== "none" &&
    (priority?.weight ?? 0) > (defaultPriority?.weight ?? 0)
  )
    details.push({
      key: "priority",
      label: t({ message: "Priority" }),
      value: metadata[index]?.label ?? task.priority,
      rawValue: task.priority,
    });
  return details;
}

import { useTaskSelecting, useTaskSelection } from "../app/use-task-selection";
import { taskMeta } from "../i18n/presentation";
import { linkDisplayLabel, linkTarget } from "../domain/completion";
import { t } from "@lingui/core/macro";
import { useLingui, Trans } from "@lingui/react/macro";
import {
  Check,
  AtSign,
  CalendarDays,
  Circle,
  Folder,
  Flag,
  Hash,
  Ellipsis,
  Square,
  Target,
  type LucideIcon,
} from "lucide-react";
import { completionKey } from "../application/task-mutations";
import { useMutationState } from "./use-mutation-state";
import {
  createElement,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type FocusEvent,
} from "react";

import {
  activeTimeEntry,
  taskDatePart,
  taskTimePart,
  todayString,
} from "../domain/task";
import { formatTaskTime } from "../i18n/presentation";
import { relativeDateDetail } from "../i18n/view-presentation";
import { occurrenceTask } from "../domain/task-occurrence";
import { actionFeedback, successFeedback } from "../native/feedback";
import { useRepository } from "../app/repository-context";
import { RecordWriteNotice } from "./record-write-notice";
import { TaskActions } from "./task-actions";
import { TaskPropertyEditor } from "./task-property-editor";
import { TaskPropertiesSheet } from "./task-properties-sheet";
import { canEditProperty } from "./task-property-kind";
import { useExitingValue } from "./overlays/use-presence";
import { useSwipeActions } from "./use-swipe-actions";
import { useTaskShortcuts } from "./use-task-shortcuts";
import { preserveRowFocus } from "../app/keyboard-shortcuts";
import { useTaskOpen } from "../app/open-task";
import { rescheduleInput } from "../domain/task-date-actions";
import { markedPriorityColorOf } from "../domain/task-configuration";
import { rememberTaskEdit } from "../app/task-edit-undo";
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
  supportingInline = false,
  ensurePriority = true,
  sectionDay,
  contextProperties = {},
  omittedProperties = [],
}: {
  task: TaskSummary;
  onOpen(task: TaskSummary, occurrenceDate?: string): void;
  onToggle(task: TaskSummary, occurrenceDate?: string): void | Promise<unknown>;
  details?: TaskRowDetail[];
  occurrence?: TaskOccurrence;
  supportingText?: string;
  supportingInline?: boolean;
  /** Show a raised priority even when the view does not select the property. */
  ensurePriority?: boolean;
  /** The day the surrounding section names; a matching date is not repeated. */
  sectionDay?: string;
  contextProperties?: Record<string, unknown>;
  omittedProperties?: string[];
}) {
  const { t } = useLingui();
  const supportingId = useId();
  const selection = useTaskSelection(task.id);
  const selecting = useTaskSelecting();
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
  const missedDeadline =
    !displayedTask.completed &&
    !!displayedTask.due &&
    taskDatePart(displayedTask.due) < todayString();
  const status = configuration.statuses.find(
    (candidate) => candidate.value === displayedTask.status,
  );
  const distinctStatus =
    !displayedTask.completed &&
    Boolean(status) &&
    displayedTask.status !== configuration.defaults.status &&
    displayedTask.status !== "none";
  const raisedPriorityColor = displayedTask.completed
    ? undefined
    : markedPriorityColorOf(task.priority, configuration);
  const [seenCompleted, setSeenCompleted] = useState(displayedTask.completed);
  if (seenCompleted !== displayedTask.completed) {
    setSeenCompleted(displayedTask.completed);
    if (!displayedTask.completed) setJustCompleted(false);
  }
  const tracking = Boolean(activeTimeEntry(task.timeEntries));
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const propertiesTrigger = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState<{
    detail: TaskRowDetail;
    anchor: TaskPropertyEditorAnchor;
  } | null>(null);
  const shownEditor = useExitingValue(editing);
  function openDetail(detail: TaskRowDetail, trigger: HTMLButtonElement) {
    if (canEditProperty(detail.key, configuration)) {
      editorTrigger.current = trigger;
      setEditing({ detail, anchor: editorAnchor(trigger) });
    } else {
      onOpen(task, occurrence?.date);
    }
  }
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const allDetails = withDistinctStatus(
    withRaisedPriority(
      details ?? defaultTaskDetails(displayedTask, metadata, configuration),
      ensurePriority,
      displayedTask,
      configuration,
    ),
    ensurePriority,
    displayedTask,
    configuration,
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
    .map((detail) => priorityOptionDetail(detail, configuration))
    .map((detail) => relativeDateDetail(detail, displayedTask, configuration));
  if (
    task.projects?.length &&
    !allDetails.some((detail) =>
      [configuration.fieldMapping.projects, "projects"].includes(
        propertyField(detail),
      ),
    )
  )
    allDetails.push({
      key: "projects",
      label: t`Projects`,
      value: task.projects.map(linkDisplayLabel).join(", "),
      rawValue: task.projects,
    });
  const contextualDetails = allDetails.flatMap((detail) => {
    const canonicalField = (key: string) => {
      const field = propertyField({ ...detail, key });
      return (
        Object.entries(configuration.fieldMapping).find(
          ([, mapped]) => mapped === field,
        )?.[0] ?? field
      );
    };
    const field = canonicalField(detail.key);
    if (omittedProperties.some((key) => canonicalField(key) === field))
      return [];
    const context = Object.entries(contextProperties).find(
      ([key]) => canonicalField(key) === field,
    )?.[1];
    if (context === undefined) return [detail];
    const matches = (value: unknown) =>
      [context]
        .flat()
        .some((entry) =>
          typeof value === "string" && typeof entry === "string"
            ? linkTarget(value).toLocaleLowerCase() ===
              linkTarget(entry).toLocaleLowerCase()
            : value === entry,
        );
    if (Array.isArray(detail.rawValue)) {
      const values = detail.rawValue.filter((value) => !matches(value));
      return values.length
        ? [
            {
              ...detail,
              rawValue: values,
              value: values
                .map((value) => linkDisplayLabel(String(value)))
                .join(", "),
            },
          ]
        : [];
    }
    return matches(detail.rawValue) ? [] : [detail];
  });
  const shownDetails = sectionDetails(
    contextualDetails,
    sectionDay,
    configuration,
  ).sort(
    (first, second) =>
      Number(Boolean(second.overdue)) - Number(Boolean(first.overdue)) ||
      detailRank(first, configuration) - detailRank(second, configuration),
  );
  const statusColor = distinctStatus ? status?.color : undefined;
  const context = supportingText ? (
    <small id={supportingId} className="task-row-context">
      {supportingText}
    </small>
  ) : null;
  const contextLeadsDetails =
    supportingInline && Boolean(details) && shownDetails.length > 0;
  const rowRef = useRef<HTMLDivElement>(null);
  const open = useTaskOpen(task.id);
  useLayoutEffect(() => {
    if (open && !rowRef.current?.closest(".full-calendar-view.is-agenda"))
      rowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [open]);
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
    yieldToSelection: selection.holdsTasks,
    schedule: async (scheduled, when) => {
      try {
        const input = rescheduleInput(task, taskDatePart(scheduled));
        const change = { ...input, scheduled };
        const saved = await updateTask(task.id, change);
        const title = task.title;
        rememberTaskEdit({
          before: task,
          saved,
          input: change,
          notice: input.due
            ? t`Moved “${title}” and its due date to ${when}`
            : t`Moved “${title}” to ${when}`,
          getSummary: (id) => repository.getSummary(id),
          updateTask,
        });
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
    onLongPress: selection.selectable ? selection.start : undefined,
    selectionActive: selection.active,
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
      className={`task-row${displayedTask.completed ? " is-complete" : ""}${missedDeadline ? " has-missed-deadline" : ""}${justCompleted && displayedTask.completed ? " is-just-completed" : ""}${tracking ? " is-tracking" : ""}${selection.selected ? " is-selected" : ""}${open ? " is-open" : ""}${swipe.offset ? " is-swiping" : ""}${swipe.direction ? " is-swipe-ready" : ""}`}
      data-selected={selection.selectable ? selection.selected : undefined}
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
      onClickCapture={(event) => {
        swipe.handlers.onClickCapture(event);
        if (!event.defaultPrevented) selection.click(event);
      }}
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
        swipe.handlers.onContextMenu(event);
        if (event.defaultPrevented) return;
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
        className={`completion-control${statusColor ? " has-status" : ""}${raisedPriorityColor ? " has-priority" : ""}`}
        type="button"
        aria-label={
          selecting
            ? selection.selected
              ? t`Deselect ${task.title}`
              : t`Select ${task.title}`
            : `${displayedTask.completed ? t({ message: "Reopen" }) : t({ message: "Complete" })} ${task.title}${distinctStatus ? `, ${status?.label ?? displayedTask.status}` : ""}`
        }
        aria-pressed={selecting ? selection.selected : displayedTask.completed}
        aria-busy={pending}
        disabled={pending}
        title={distinctStatus ? status?.label : undefined}
        style={
          // Priority draws the tick beside the circle and status colours the
          // circle; the row's label names both.
          {
            ...(statusColor ? { "--status-color": statusColor } : {}),
            ...(raisedPriorityColor
              ? { "--priority-color": raisedPriorityColor }
              : {}),
          } as React.CSSProperties
        }
        onClick={() => {
          if (selecting) selection.toggle();
          else void complete();
        }}
      >
        <span aria-hidden="true" />
      </button>
      {selection.selected ? (
        <Check className="task-selection-mark" aria-hidden="true" size={16} />
      ) : null}
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
        <div className="task-row-reading">
          <button
            className="task-row-title"
            aria-label={task.title}
            aria-description={
              shownDetails
                .map((detail) => `${detail.label}: ${detail.value}`)
                .join(", ") || undefined
            }
            aria-pressed={selection.selectable ? selection.selected : undefined}
            aria-describedby={supportingText ? supportingId : undefined}
            title={task.title}
            type="button"
            onClick={() => onOpen(task, occurrence?.date)}
          >
            <span className="task-row-title-text">
              <span>{task.title}</span>
            </span>
            {tracking || shownDetails.length ? (
              <span className="task-row-compact-metadata" aria-hidden="true">
                {tracking ? <TrackingIndicator /> : null}
                {shownDetails.map((detail) => (
                  <span
                    key={detail.key}
                    data-property={propertyField(detail)}
                    className={`task-row-metadata-unit${detail.overdue ? " is-overdue" : ""}${[configuration.fieldMapping.projects, "projects"].includes(propertyField(detail)) ? " is-project" : ""}`}
                  >
                    <PropertyGlyph detail={detail} />
                    <span className="task-row-value">
                      {isDueDetail(detail, configuration)
                        ? t`Due ${detail.value}`
                        : detail.value}
                    </span>
                  </span>
                ))}
              </span>
            ) : null}
          </button>
        </div>
        {context && !contextLeadsDetails ? context : null}
        {details ? (
          tracking || shownDetails.length ? (
            <span
              className="task-row-properties task-row-inline-metadata"
              role="toolbar"
              aria-label={t`Properties for ${task.title}`}
              onKeyDown={navigateRowProperties}
              onFocus={focusRowProperty}
            >
              {tracking ? <TrackingIndicator /> : null}
              {contextLeadsDetails ? context : null}
              {shownDetails.map((detail, index) => (
                <button
                  className={`task-row-property${isCompactDetail(detail, configuration) ? " is-compact" : ""}${propertyField(detail) === configuration.fieldMapping.projects || propertyField(detail) === "projects" ? " is-project" : ""}${detailRank(detail, configuration) === 0 ? " is-date" : ""}${detailRank(detail, configuration) === 2 ? " is-organisation" : ""}${detail.overdue ? " is-overdue" : ""}`}
                  key={detail.key}
                  title={
                    detail.description ?? `${detail.label}: ${detail.value}`
                  }
                  aria-label={`${detail.label}: ${detail.value}`}
                  type="button"
                  tabIndex={index === 0 ? 0 : -1}
                  onClick={(event) => openDetail(detail, event.currentTarget)}
                >
                  <span>{detail.label}</span>
                  <strong>
                    <PropertyGlyph detail={detail} />
                    <span className="task-row-value">
                      {isDueDetail(detail, configuration)
                        ? t`Due ${detail.value}`
                        : detail.value}
                    </span>
                  </strong>
                </button>
              ))}
            </span>
          ) : null
        ) : tracking || shownDetails.length ? (
          <span
            className="task-row-meta task-row-inline-metadata"
            role="toolbar"
            aria-label={t`Properties for ${task.title}`}
            onKeyDown={navigateRowProperties}
            onFocus={focusRowProperty}
          >
            {tracking ? <TrackingIndicator /> : null}
            {shownDetails.map((detail, index) => (
              <button
                className={detail.overdue ? "is-overdue" : undefined}
                aria-label={`${detail.label}: ${detail.value}`}
                key={detail.key}
                tabIndex={index === 0 ? 0 : -1}
                title={`${detail.label}: ${detail.value}`}
                type="button"
                onClick={(event) => openDetail(detail, event.currentTarget)}
              >
                <PropertyGlyph detail={detail} />
                <span className="task-row-value">
                  {isDueDetail(detail, configuration)
                    ? t`Due ${detail.value}`
                    : detail.value}
                </span>
              </button>
            ))}
          </span>
        ) : null}
        <RecordWriteNotice
          repository={repository}
          target={{ kind: "task", id: task.id }}
        />
      </div>
      <button
        className="task-row-properties-trigger"
        type="button"
        ref={propertiesTrigger}
        aria-label={t`Properties for ${task.title}`}
        aria-description={shownDetails
          .map((detail) => `${detail.label}: ${detail.value}`)
          .join(", ")}
        aria-haspopup="dialog"
        aria-expanded={propertiesOpen}
        onClick={() => setPropertiesOpen(true)}
      >
        <Ellipsis aria-hidden="true" size={18} />
      </button>
      <TaskActions
        task={task}
        occurrenceDate={occurrence?.date}
        onOpen={onOpen}
        onToggle={onToggle}
      />
      {propertiesOpen ? (
        <TaskPropertiesSheet
          task={task}
          onClose={() => {
            setPropertiesOpen(false);
            requestAnimationFrame(() => propertiesTrigger.current?.focus());
          }}
        />
      ) : null}
      {shownEditor.value ? (
        <TaskPropertyEditor
          anchor={shownEditor.value.anchor}
          detail={shownEditor.value.detail}
          key={shownEditor.key}
          occurrenceDate={occurrence?.date}
          open={Boolean(editing)}
          task={task}
          onClose={() => {
            setEditing(null);
            window.requestAnimationFrame(() => editorTrigger.current?.focus());
          }}
          onExited={shownEditor.clear}
        />
      ) : null}
    </div>
  );
}

function focusRowProperty(event: FocusEvent<HTMLElement>) {
  for (const button of event.currentTarget.querySelectorAll<HTMLButtonElement>(
    "button",
  ))
    button.tabIndex = button === event.target ? 0 : -1;
}

function navigateRowProperties(event: KeyboardEvent<HTMLElement>) {
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
  )
    return;
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    ),
  ];
  const index = buttons.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  event.stopPropagation();
  const direction =
    getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (index +
            (event.key === "ArrowRight" ? direction : -direction) +
            buttons.length) %
          buttons.length;
  buttons[next]?.focus();
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

/** Rows name known properties with a glyph; the label stays the accessible
 * name and tooltip, and a priority's stored colour marks its flag. */
function PropertyGlyph({ detail }: { detail: TaskRowDetail }) {
  const { configuration } = useRepository();
  const Icon = propertyIcon(detail, configuration);
  if (!Icon) return null;
  const color =
    detailPriorityColor(detail, configuration) ??
    detailStatusColor(detail, configuration);
  return createElement(Icon, {
    "aria-hidden": true,
    className: "task-row-glyph",
    fill: color ?? "none",
    size: 14,
    strokeWidth: 1.8,
    style: color ? { color } : undefined,
  });
}

function detailStatusColor(
  detail: TaskRowDetail,
  { fieldMapping, statuses }: RowConfiguration,
): string | undefined {
  const key = propertyField(detail);
  if (key !== fieldMapping.status && key !== "status") return undefined;
  return statuses.find(({ value }) => value === detail.rawValue)?.color;
}

function propertyField(detail: TaskRowDetail): string {
  const bracketed = /^note\[(?:"|')(.+)(?:"|')\]$/.exec(detail.key);
  return bracketed?.[1] ?? detail.key.replace(/^note\./, "");
}

function detailRank(detail: TaskRowDetail, { fieldMapping }: RowConfiguration) {
  const field = propertyField(detail);
  if (
    [fieldMapping.scheduled, fieldMapping.due, "scheduled", "due"].includes(
      field,
    )
  )
    return 0;
  if (
    [
      fieldMapping.projects,
      fieldMapping.contexts,
      "projects",
      "contexts",
      "tags",
    ].includes(field)
  )
    return 2;
  return 1;
}

type RowConfiguration =
  import("../domain/task-configuration").TaskCollectionConfiguration;

function propertyIcon(
  detail: TaskRowDetail,
  { fieldMapping }: RowConfiguration,
): LucideIcon | null {
  const key = propertyField(detail);
  if (key === fieldMapping.scheduled || key === "scheduled")
    return CalendarDays;
  if (key === fieldMapping.due || key === "due") return Target;
  if (key === fieldMapping.status || key === "status") return Circle;
  if (key === fieldMapping.priority || key === "priority") return Flag;
  if (key === fieldMapping.projects || key === "projects") return Folder;
  if (key === fieldMapping.contexts || key === "contexts") return AtSign;
  if (key === "tags") return Hash;
  return null;
}

/** A section named for a day already says when; only a time adds anything. */
function sectionDetails(
  details: TaskRowDetail[],
  day: string | undefined,
  configuration: RowConfiguration,
): TaskRowDetail[] {
  const isProject = (detail: TaskRowDetail) => {
    const key = propertyField(detail);
    return key === configuration.fieldMapping.projects || key === "projects";
  };
  // The project closes the line, so wide lists can align it at the far edge.
  const ordered = [
    ...details.filter((detail) => !isProject(detail)),
    ...details.filter(isProject),
  ];
  if (!day) return ordered;
  return ordered.flatMap((detail) => {
    const key = propertyField(detail);
    if (
      (key !== configuration.fieldMapping.scheduled && key !== "scheduled") ||
      typeof detail.rawValue !== "string" ||
      taskDatePart(detail.rawValue) !== day
    )
      return [detail];
    const time = taskTimePart(detail.rawValue);
    return time ? [{ ...detail, value: formatTaskTime(time) }] : [];
  });
}

function withRaisedPriority(
  details: TaskRowDetail[],
  ensure: boolean,
  task: TaskSummary,
  configuration: RowConfiguration,
): TaskRowDetail[] {
  if (
    !ensure ||
    details.some((detail) => {
      const key = propertyField(detail);
      return key === configuration.fieldMapping.priority || key === "priority";
    })
  )
    return details;
  const priority = configuration.priorities.find(
    (option) => option.value === task.priority,
  );
  const fallback = configuration.priorities.find(
    (option) => option.value === configuration.defaults.priority,
  );
  if (!priority || priority.value === fallback?.value) return details;
  return [
    ...details,
    {
      key: "priority",
      label: t({ message: "Priority" }),
      value: priority.label,
      rawValue: priority.value,
    },
  ];
}

/** A status beyond the default is named, since its colour alone can't say it. */
function withDistinctStatus(
  details: TaskRowDetail[],
  ensure: boolean,
  task: TaskSummary,
  configuration: RowConfiguration,
): TaskRowDetail[] {
  const status = configuration.statuses.find(
    (option) => option.value === task.status,
  );
  if (
    !ensure ||
    task.completed ||
    !status ||
    status.value === "none" ||
    status.value === configuration.defaults.status ||
    details.some((detail) => {
      const key = propertyField(detail);
      return key === configuration.fieldMapping.status || key === "status";
    })
  )
    return details;
  return [
    {
      key: "status",
      label: t({ message: "Status" }),
      value: status.label,
      rawValue: status.value,
    },
    ...details,
  ];
}

/** A selected priority property reads as its option, as the menus name it. */
function priorityOptionDetail(
  detail: TaskRowDetail,
  configuration: RowConfiguration,
): TaskRowDetail {
  const key = propertyField(detail);
  if (key !== configuration.fieldMapping.priority && key !== "priority")
    return detail;
  const option = configuration.priorities.find(
    ({ value }) => value === detail.rawValue,
  );
  return option ? { ...detail, value: option.label } : detail;
}

function isDueDetail(
  detail: TaskRowDetail,
  { fieldMapping }: RowConfiguration,
): boolean {
  const key = propertyField(detail);
  return key === fieldMapping.due || key === "due";
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
  return (
    markedPriorityColorOf(detail.rawValue, configuration) ??
    configuration.priorities.find((option) => option.value === detail.rawValue)
      ?.color
  );
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

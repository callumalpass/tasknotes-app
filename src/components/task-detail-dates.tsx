import { Trans, useLingui } from "@lingui/react/macro";
import { CalendarDays, X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  combineTaskDateTime,
  formatTaskDate,
  taskDatePart,
  taskTimePart,
  type UpdateTaskInput,
} from "../domain/task";
import type { Draft } from "../app/task-editor-draft";
import { TaskDatePanel } from "./task-date-panel";
import { TaskNotesTimePicker } from "./tasknotes-controls";
import { useOverlay } from "./overlays/use-overlay";
import "./task-detail-dates.css";

type DateTarget = "scheduled" | "due";

export function TaskDetailDates({
  compact = false,
  draft,
  onChange,
}: {
  compact?: boolean;
  draft: Pick<Draft, DateTarget>;
  onChange(patch: Partial<Draft>): void;
}) {
  const { t } = useLingui();
  const [target, setTarget] = useState<DateTarget | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      {(["scheduled", "due"] as const).map((field) => {
        const label = field === "scheduled" ? t`Scheduled` : t`Due`;
        const date = taskDatePart(draft[field]);
        return (
          <div
            className={`form-field date-time-field tasknotes-control-field${date ? "" : " is-empty"}`}
            key={field}
          >
            <span>{label}</span>
            <div>
              <button
                aria-description={date ? formatTaskDate(date) : t`No date`}
                aria-expanded={target === field}
                aria-haspopup="dialog"
                aria-label={t`${label} date`}
                className="tasknotes-control-trigger tasknotes-date-trigger"
                data-value={date}
                type="button"
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  setTarget(target === field ? null : field);
                }}
              >
                <CalendarDays aria-hidden="true" size={16} strokeWidth={1.65} />
                <span className={date ? undefined : "is-placeholder"}>
                  {compact ? `${label}: ` : ""}
                  {date
                    ? formatTaskDate(compact ? draft[field]! : date)
                    : t`No date`}
                </span>
              </button>
              {date && !compact ? (
                <TaskNotesTimePicker
                  ariaLabel={t`${label} time`}
                  value={taskTimePart(draft[field]) || undefined}
                  onChange={(time) =>
                    onChange({ [field]: combineTaskDateTime(date, time) })
                  }
                />
              ) : null}
            </div>
          </div>
        );
      })}
      {target ? (
        <TaskDatePopover
          key={target}
          draft={draft}
          showTime={compact}
          target={target}
          trigger={trigger}
          onClose={() => setTarget(null)}
          onApply={(input) => {
            const patch: Partial<Draft> = {};
            for (const field of ["scheduled", "due"] as const)
              if (field in input) patch[field] = input[field] ?? undefined;
            onChange(patch);
            setTarget(null);
          }}
        />
      ) : null}
    </>
  );
}

/** The date tool anchored to a trigger, for any surface that sets a date. */
export function TaskDatePopover({
  draft,
  planOnly = false,
  showTime = false,
  target,
  title,
  trigger,
  onClose,
  onApply,
}: {
  draft: Pick<Draft, DateTarget>;
  planOnly?: boolean;
  showTime?: boolean;
  target: DateTarget;
  title?: string;
  trigger: RefObject<HTMLElement | null>;
  onClose(): void;
  onApply(input: UpdateTaskInput): void;
}) {
  const { t } = useLingui();
  const root = useRef<HTMLDivElement>(null);
  const label = target === "scheduled" ? t`Scheduled` : t`Due`;
  useLayoutEffect(() => {
    const panel = root.current;
    const anchor = trigger.current;
    if (!panel || !anchor) return;
    const position = () => {
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      if (window.matchMedia?.("(max-width: 839px)").matches) {
        panel.style.width = `${width}px`;
        panel.style.maxHeight = `${Math.min(height * 0.86, 620)}px`;
        panel.style.left = `${left}px`;
        panel.style.top = "auto";
        panel.style.bottom = `${Math.max(0, window.innerHeight - top - height)}px`;
        return;
      }
      const bounds = anchor.getBoundingClientRect();
      panel.style.bottom = "auto";
      panel.style.width = `${Math.min(340, width - 24)}px`;
      panel.style.maxHeight = `${height - 24}px`;
      panel.style.left = `${Math.max(left + 12, Math.min(bounds.left, left + width - panel.offsetWidth - 12))}px`;
      panel.style.top = `${Math.max(top + 12, Math.min(bounds.bottom + 6, top + height - panel.offsetHeight - 12))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [trigger]);
  useOverlay({
    open: true,
    rootRef: root,
    returnFocusRef: trigger,
    onDismiss: onClose,
    initialFocus: () =>
      root.current?.querySelector<HTMLButtonElement>(
        ".task-date-presets button",
      ) ?? null,
  });
  return createPortal(
    <>
      <button
        aria-label={t`Close dates`}
        className="tasknotes-popover-scrim task-detail-date-scrim"
        data-state="open"
        tabIndex={-1}
        type="button"
        onClick={onClose}
      />
      <div
        className="task-detail-date-popover"
        aria-label={title ?? t`${label} date calendar`}
        ref={root}
        role="dialog"
      >
        <header>
          <strong>{title ?? <Trans>Dates</Trans>}</strong>
          <button
            aria-label={t`Close dates`}
            className="icon-button"
            type="button"
            onClick={onClose}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <TaskDatePanel
          busy={false}
          initialTarget={target}
          planOnly={planOnly}
          showTime={showTime}
          task={draft}
          onApply={onApply}
        />
      </div>
    </>,
    document.body,
  );
}

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
  draft,
  onChange,
}: {
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
            className="form-field date-time-field tasknotes-control-field"
            key={field}
          >
            <span>{label}</span>
            <div>
              <button
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
                  {date ? formatTaskDate(date) : t`No date`}
                </span>
              </button>
              <TaskNotesTimePicker
                ariaLabel={t`${label} time`}
                disabled={!date}
                value={taskTimePart(draft[field]) || undefined}
                onChange={(time) =>
                  onChange({ [field]: combineTaskDateTime(date, time) })
                }
              />
            </div>
          </div>
        );
      })}
      {target ? (
        <DetailDatePopover
          key={target}
          draft={draft}
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

function DetailDatePopover({
  draft,
  target,
  trigger,
  onClose,
  onApply,
}: {
  draft: Pick<Draft, DateTarget>;
  target: DateTarget;
  trigger: RefObject<HTMLButtonElement | null>;
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
      const bounds = anchor.getBoundingClientRect();
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
      root.current?.querySelector<HTMLInputElement>("input") ?? null,
  });
  return createPortal(
    <div
      className="task-detail-date-popover"
      aria-label={t`${label} date calendar`}
      ref={root}
      role="dialog"
    >
      <header>
        <strong>
          <Trans>Dates</Trans>
        </strong>
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
        task={draft}
        onApply={onApply}
      />
    </div>,
    document.body,
  );
}

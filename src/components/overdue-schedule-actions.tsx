import { plural } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { taskDatePart, todayString } from "../domain/task";
import { TaskDatePopover } from "./task-detail-dates";

const NO_DATES = { scheduled: undefined, due: undefined };

/**
 * Moves every overdue task at once. A missed deadline is a commitment, not a
 * plan, so moving one is asked first and never a side effect.
 */
export function OverdueScheduleActions({
  buttonClassName = "section-heading-action",
  count,
  deadlines,
  pending,
  onSchedule,
}: {
  buttonClassName?: string;
  count: number;
  deadlines: number;
  pending: boolean;
  onSchedule(date: string, keepDeadlines: boolean): Promise<void> | void;
}) {
  const { t } = useLingui();
  const [picking, setPicking] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstAnswer = useRef<HTMLButtonElement>(null);
  // The button that opened this choice has just gone, taking focus with it.
  useEffect(() => {
    if (asking) firstAnswer.current?.focus();
  }, [asking]);
  function choose(date: string) {
    if (deadlines) setAsking(date);
    else void onSchedule(date, false);
  }
  function answer(keepDeadlines: boolean) {
    if (!asking) return;
    setAsking(null);
    void onSchedule(asking, keepDeadlines);
  }
  if (asking)
    return (
      <span
        aria-label={t`Missed deadlines`}
        className="overdue-deadline-choice"
        role="group"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          setAsking(null);
        }}
      >
        <span>
          <Plural
            value={deadlines}
            one="# missed deadline"
            other="# missed deadlines"
          />
        </span>
        <button
          className={buttonClassName}
          disabled={pending}
          ref={firstAnswer}
          type="button"
          onClick={() => answer(false)}
        >
          <Trans>Move deadlines too</Trans>
        </button>
        <button
          className={buttonClassName}
          disabled={pending}
          type="button"
          onClick={() => answer(true)}
        >
          <Trans>Keep deadlines</Trans>
        </button>
      </span>
    );
  return (
    <span className="overdue-schedule-actions">
      <button
        className={buttonClassName}
        type="button"
        disabled={pending}
        aria-label={plural(count, {
          one: "Move all to today, # overdue task",
          other: "Move all to today, # overdue tasks",
        })}
        onClick={() => choose(todayString())}
      >
        <Trans>Move all to today</Trans>
      </button>
      <button
        aria-expanded={picking}
        aria-haspopup="dialog"
        className={buttonClassName}
        disabled={pending}
        ref={trigger}
        type="button"
        onClick={() => setPicking(!picking)}
      >
        <Trans>Choose date</Trans>
      </button>
      {picking ? (
        <TaskDatePopover
          draft={NO_DATES}
          planOnly
          target="scheduled"
          title={t`Date for overdue tasks`}
          trigger={trigger}
          onClose={() => setPicking(false)}
          onApply={({ scheduled }) => {
            setPicking(false);
            if (scheduled) choose(taskDatePart(scheduled));
          }}
        />
      ) : null}
    </span>
  );
}

import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useId, useRef, useState } from "react";
import { todayString } from "../domain/task";
import { nextWeekStart } from "../app/keyboard-shortcuts";
import {
  rescheduleInput,
  setTaskDate,
  shiftTaskDate,
} from "../domain/task-date-actions";
import {
  combineTaskDateTime,
  formatTaskDate,
  taskDatePart,
  taskTimePart,
} from "../domain/task";
import { parseTaskCapture } from "../domain/task-capture";
import { useRepository } from "../app/repository-context";
import { StandaloneCalendar, TaskNotesTimePicker } from "./tasknotes-controls";
import "./task-date-panel.css";

import type { TaskSummary, UpdateTaskInput } from "../domain/task";

type DateTarget = "scheduled" | "due";

/** One place to set either date: typed, picked from a preset, or from the
 * calendar. The target stays explicit, and a date-only choice keeps a time
 * already on the task. */
export function TaskDatePanel({
  busy,
  task,
  initialTarget,
  planOnly = false,
  showTime = false,
  onApply,
}: {
  busy: boolean;
  task: Pick<TaskSummary, "scheduled" | "due">;
  initialTarget?: DateTarget;
  /** For choosing one plan date across many tasks. */
  planOnly?: boolean;
  showTime?: boolean;
  onApply(input: UpdateTaskInput): void;
}) {
  const { t } = useLingui();
  const { configuration } = useRepository();
  const [target, setTarget] = useState<DateTarget>(
    initialTarget ?? (task.due && !task.scheduled ? "due" : "scheduled"),
  );
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<{ text: string; date?: string }>();
  const hintId = useId();
  const requested = useRef("");
  const today = todayString();
  const weekday = new Date(`${today}T12:00:00`).getDay();
  const weekend = shiftTaskDate(today, (6 - weekday + 7) % 7 || 7);
  const current = task[target];
  const label = target === "scheduled" ? t`Scheduled` : t`Due`;
  const shownDate = parsed?.text === text ? parsed.date : undefined;
  const unreadable = Boolean(
    text.trim() && parsed?.text === text && !shownDate,
  );

  useEffect(() => {
    const value = text.trim();
    requested.current = text;
    if (!value) return;
    void parseTaskCapture(value, configuration).then(
      ({ input }) => {
        if (requested.current === text)
          setParsed({
            text,
            date: input[target] ?? input.scheduled ?? input.due,
          });
      },
      () => {
        if (requested.current === text) setParsed({ text });
      },
    );
  }, [configuration, target, text]);

  function apply(date: string) {
    if (busy) return;
    const value = date.includes("T") ? date : setTaskDate(current, date);
    onApply(
      target === "scheduled"
        ? { ...rescheduleInput(task, taskDatePart(date)), scheduled: value }
        : { due: value },
    );
  }

  return (
    <div className="task-date-panel">
      {planOnly ? null : (
        <div
          aria-label={t`Date to change`}
          className="task-date-target"
          role="radiogroup"
        >
          {(["scheduled", "due"] as const).map((option) => (
            <button
              aria-checked={target === option}
              disabled={busy}
              key={option}
              role="radio"
              type="button"
              onClick={() => setTarget(option)}
            >
              {option === "scheduled" ? t`Scheduled` : t`Due`}
              {task[option] ? (
                <small>{formatTaskDate(task[option])}</small>
              ) : null}
            </button>
          ))}
        </div>
      )}
      <div className="task-date-presets">
        <button disabled={busy} type="button" onClick={() => apply(today)}>
          <Trans>Today</Trans>
        </button>
        <button
          disabled={busy}
          type="button"
          onClick={() => apply(shiftTaskDate(today, 1))}
        >
          <Trans>Tomorrow</Trans>
        </button>
        <button disabled={busy} type="button" onClick={() => apply(weekend)}>
          <Trans>This weekend</Trans>
        </button>
        <button
          disabled={busy}
          type="button"
          onClick={() => apply(nextWeekStart(today))}
        >
          <Trans>Next week</Trans>
        </button>
      </div>
      <StandaloneCalendar
        key={target}
        value={taskDatePart(current)}
        onChoose={(date) => apply(date)}
      />
      <details className="task-date-more">
        <summary>
          <Trans>Date options</Trans>
        </summary>
        {showTime && current ? (
          <TaskNotesTimePicker
            ariaLabel={t`${label} time`}
            disabled={busy}
            value={taskTimePart(current) || undefined}
            onChange={(time) =>
              onApply({
                [target]: combineTaskDateTime(taskDatePart(current), time),
              })
            }
          />
        ) : null}
        <input
          aria-describedby={hintId}
          aria-invalid={unreadable}
          aria-label={t`Type a date`}
          autoComplete="off"
          className="task-date-input"
          disabled={busy}
          placeholder={t`Fri 3pm, next week, Dec 12`}
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !shownDate) return;
            event.preventDefault();
            apply(shownDate);
          }}
        />
        <p
          className={`task-date-hint${unreadable ? " is-error" : ""}`}
          id={hintId}
        >
          {shownDate
            ? t`Enter to set ${formatTaskDate(shownDate)}`
            : unreadable
              ? t`Couldn’t read that date`
              : target === "scheduled"
                ? t`When you plan to work on it`
                : t`When it has to be done`}
        </p>
        {current ? (
          <button
            className="task-date-clear"
            disabled={busy}
            type="button"
            onClick={() => onApply({ [target]: null })}
          >
            {target === "scheduled"
              ? t`Clear scheduled date`
              : t`Clear due date`}
          </button>
        ) : null}
      </details>
    </div>
  );
}

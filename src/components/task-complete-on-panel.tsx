import { Trans, useLingui } from "@lingui/react/macro";

import { taskDatePart, todayString } from "../domain/task";
import { shiftTaskDate } from "../domain/task-date-actions";
import { formatTaskDate } from "../i18n/presentation";
import { StandaloneCalendar } from "./tasknotes-controls";
import "./task-date-panel.css";

import type { TaskSummary } from "../domain/task";

/**
 * Chooses the day a completion is recorded for. A repeating task gets that
 * day's occurrence ticked; any other task gets it as its completion date.
 */
export function TaskCompleteOnPanel({
  busy,
  task,
  onChoose,
}: {
  busy: boolean;
  task: Pick<TaskSummary, "scheduled" | "due" | "recurrence">;
  onChoose(date: string): void;
}) {
  const { t } = useLingui();
  const today = todayString();
  const yesterday = shiftTaskDate(today, -1);
  // The task's own dates are the likeliest late answers, when they are past.
  const presets: { date: string; label: string }[] = [];
  for (const [value, label] of [
    [task.scheduled, t`Scheduled`],
    [task.due, t`Due`],
  ] as const) {
    const date = value ? taskDatePart(value) : "";
    if (!date || date >= yesterday) continue;
    if (presets.some((preset) => preset.date === date)) continue;
    presets.push({ date, label });
  }
  return (
    <div className="task-date-panel task-complete-on-panel">
      <p className="task-date-hint">
        {task.recurrence ? (
          <Trans>Marks that day’s occurrence as done.</Trans>
        ) : (
          <Trans>Records the day you finished it.</Trans>
        )}
      </p>
      <div className="task-date-presets">
        <button
          disabled={busy}
          type="button"
          onClick={() => onChoose(yesterday)}
        >
          <Trans>Yesterday</Trans>
        </button>
        {presets.map((preset) => (
          <button
            disabled={busy}
            key={preset.date}
            type="button"
            onClick={() => onChoose(preset.date)}
          >
            {preset.label}
            <small>{formatTaskDate(preset.date)}</small>
          </button>
        ))}
      </div>
      <StandaloneCalendar onChoose={onChoose} />
    </div>
  );
}

import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { todayString } from "../domain/task";

export function OverdueScheduleActions({
  count,
  pending,
  onSchedule,
}: {
  count: number;
  pending: boolean;
  onSchedule(date: string): Promise<void>;
}) {
  const { t } = useLingui();
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState("");
  return (
    <span className="overdue-schedule-actions">
      <button
        className="section-heading-action"
        type="button"
        disabled={pending}
        aria-label={plural(count, {
          one: "Move all to today, # overdue task",
          other: "Move all to today, # overdue tasks",
        })}
        onClick={() => void onSchedule(todayString())}
      >
        <Trans>Move all to today</Trans>
      </button>
      <button
        className="section-heading-action"
        type="button"
        disabled={pending}
        aria-expanded={picking}
        onClick={() => setPicking(!picking)}
      >
        <Trans>Choose date</Trans>
      </button>
      {picking ? (
        <span className="overdue-pick-date">
          <input
            type="date"
            aria-label={t`Date for overdue tasks`}
            value={date}
            onChange={(event) => setDate(event.currentTarget.value)}
          />
          <button
            type="button"
            className="section-heading-action"
            disabled={pending || !date}
            onClick={() => void onSchedule(date).then(() => setPicking(false))}
          >
            <Trans>Schedule all</Trans>
          </button>
        </span>
      ) : null}
    </span>
  );
}

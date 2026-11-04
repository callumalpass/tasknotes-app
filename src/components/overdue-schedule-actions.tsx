import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { taskDatePart, todayString } from "../domain/task";
import { TaskDatePopover } from "./task-detail-dates";

const NO_DATES = { scheduled: undefined, due: undefined };

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
  const trigger = useRef<HTMLButtonElement>(null);
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
        aria-expanded={picking}
        aria-haspopup="dialog"
        className="section-heading-action"
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
            if (scheduled) void onSchedule(taskDatePart(scheduled));
          }}
        />
      ) : null}
    </span>
  );
}

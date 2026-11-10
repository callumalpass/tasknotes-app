import { Trans, useLingui } from "@lingui/react/macro";
import { Square, Timer, X } from "lucide-react";

import { FeedbackNotice } from "../components/workspace-feedback";
import { formatMinutes, useTimerNow } from "./timer-clock";
import "./running-timer.css";

import type { TimerControl } from "./use-timer-control";

/**
 * The timer that is running, wherever the person is: its task, how long it
 * has run, and Stop. With several running, the most recently started shows
 * first and the next takes its place once it is stopped.
 */
export function RunningTimerNotice({
  control,
  onOpen,
}: {
  control: TimerControl;
  onOpen(id: string): void;
}) {
  const { t } = useLingui();
  const { timers, pending, problem, stop, dismissProblem } = control;
  const timer = timers[0];
  const now = useTimerNow(Boolean(timer));
  if (!timer && !problem) return null;
  const started = timer ? new Date(timer.startTime).getTime() : NaN;
  const minutes = Number.isFinite(started)
    ? Math.max(0, Math.floor((now.getTime() - started) / 60_000))
    : 0;
  return (
    <FeedbackNotice>
      <div
        aria-label={t`Running timer`}
        className={`running-timer${problem ? " has-problem" : ""}`}
        role="group"
      >
        {timer ? (
          <>
            <button
              className="running-timer-task"
              title={t`Open task`}
              type="button"
              onClick={() => onOpen(timer.id)}
            >
              <Timer aria-hidden="true" size={16} strokeWidth={1.8} />
              <span className="running-timer-title">{timer.title}</span>
              <span className="running-timer-elapsed">
                {formatMinutes(minutes)}
              </span>
            </button>
            <button
              aria-label={t`Stop timer for ${timer.title}`}
              className="running-timer-stop"
              disabled={pending}
              type="button"
              onClick={() => void stop(timer)}
            >
              <Square aria-hidden="true" fill="currentColor" size={12} />
              <span>
                <Trans>Stop</Trans>
              </span>
            </button>
          </>
        ) : null}
        {problem ? (
          <p className="running-timer-problem" role="alert">
            <span>
              {problem === "start" ? (
                <Trans>Couldn’t start the timer.</Trans>
              ) : (
                <Trans>Couldn’t stop the timer.</Trans>
              )}
            </span>
            <button
              aria-label={t`Dismiss`}
              type="button"
              onClick={dismissProblem}
            >
              <X aria-hidden="true" size={16} />
            </button>
          </p>
        ) : null}
      </div>
    </FeedbackNotice>
  );
}

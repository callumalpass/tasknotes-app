import { t } from "@lingui/core/macro";
import { useCallback, useState } from "react";

import { announceShortcut } from "./keyboard-shortcuts";
import { useRepository } from "./repository-context";
import { useRunningTimers } from "./use-running-timers";

import type { RunningTimer } from "../domain/running-timers";

export interface TimerControl {
  timers: RunningTimer[];
  pending: boolean;
  /** The last timer action that did not go through, until it is dismissed. */
  problem: "start" | "stop" | null;
  start(id: string, title: string): Promise<void>;
  stop(timer: Pick<RunningTimer, "id" | "title">): Promise<void>;
  dismissProblem(): void;
}

/**
 * One place for starting and stopping timers away from a task's own screen,
 * so the running-timer notice and the command palette agree on what happened.
 */
export function useTimerControl(): TimerControl {
  const { startTimeTracking, stopTimeTracking } = useRepository();
  const timers = useRunningTimers();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<TimerControl["problem"]>(null);
  const start = useCallback(
    async (id: string, title: string) => {
      setPending(true);
      setProblem(null);
      try {
        await startTimeTracking(id);
        announceShortcut(t`Timer started for ${title}.`);
      } catch {
        setProblem("start");
      } finally {
        setPending(false);
      }
    },
    [startTimeTracking],
  );
  const stop = useCallback(
    async ({ id, title }: Pick<RunningTimer, "id" | "title">) => {
      setPending(true);
      setProblem(null);
      try {
        await stopTimeTracking(id);
        announceShortcut(t`Timer stopped for ${title}.`);
      } catch {
        setProblem("stop");
      } finally {
        setPending(false);
      }
    },
    [stopTimeTracking],
  );
  const dismissProblem = useCallback(() => setProblem(null), []);
  return { timers, pending, problem, start, stop, dismissProblem };
}

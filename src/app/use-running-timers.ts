import { useMemo, useSyncExternalStore } from "react";

import { useRepository } from "./repository-context";

import type { RunningTimer } from "../domain/running-timers";

/** Observe already-loaded metadata; the timer must never start collection reads. */
export function useRunningTimers(): RunningTimer[] {
  const { repository, status } = useRepository();
  const serialized = useSyncExternalStore(
    (listener) => repository.subscribe(listener),
    () =>
      JSON.stringify(
        status === "ready" ? (repository.runningTimers?.() ?? []) : [],
      ),
    () => "[]",
  );
  return useMemo(() => JSON.parse(serialized) as RunningTimer[], [serialized]);
}

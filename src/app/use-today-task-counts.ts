import { useEffect, useState, useSyncExternalStore } from "react";
import { todayString } from "../domain/task";
import type { TodayTaskCounts } from "../domain/today-summary";
import { useRepository } from "./repository-context";

/** Observe already-loaded metadata; this badge must never start collection reads. */
export function useTodayTaskCounts(): TodayTaskCounts | null {
  const { repository, status } = useRepository();
  const [today, setToday] = useState(todayString);
  useEffect(() => {
    const checkDay = () => setToday(todayString());
    const timer = window.setInterval(checkDay, 60_000);
    window.addEventListener("focus", checkDay);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", checkDay);
    };
  }, []);
  const serialized = useSyncExternalStore(
    (listener) => repository.subscribe(listener),
    () =>
      JSON.stringify(
        status === "ready"
          ? (repository.todayTaskCounts?.(today) ?? null)
          : null,
      ),
    () => "null",
  );
  return JSON.parse(serialized) as TodayTaskCounts | null;
}

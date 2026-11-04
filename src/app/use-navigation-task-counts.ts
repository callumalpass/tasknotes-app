import { useSyncExternalStore } from "react";
import { todayString } from "../domain/task";
import { useRepository } from "./repository-context";

export function useNavigationTaskCounts() {
  const { repository, status } = useRepository();
  const serialized = useSyncExternalStore(
    (listener) => repository.subscribe(listener),
    () =>
      JSON.stringify(
        status === "ready"
          ? (repository.navigationTaskCounts?.(todayString()) ?? null)
          : null,
      ),
    () => "null",
  );
  return JSON.parse(serialized) as {
    unplanned: number;
    upcoming: number;
  } | null;
}

import { useSyncExternalStore } from "react";
import { todayString } from "../domain/task";
import { useRepository } from "./repository-context";

export function useNavigationTaskCounts() {
  const { repository, status, configuration } = useRepository();
  const serialized = useSyncExternalStore(
    (listener) => repository.subscribe(listener),
    () =>
      JSON.stringify(
        status === "ready"
          ? (repository.navigationTaskCounts?.(
              todayString(new Date(), configuration?.timezone),
            ) ?? null)
          : null,
      ),
    () => "null",
  );
  return JSON.parse(serialized) as {
    inbox: number;
    upcoming: number;
  } | null;
}

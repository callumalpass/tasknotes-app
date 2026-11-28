import { useSyncExternalStore } from "react";
import { starterViewKind } from "../domain/default-view-source";
import type { TaskView } from "../domain/view";
import { todayString } from "../domain/task";
import { useRepository } from "./repository-context";

export interface NavigationCounts {
  inbox: number | null;
  upcoming: number | null;
  inboxByView?: Record<string, number | null>;
}

export function useNavigationTaskCounts(views: readonly TaskView[] = []) {
  const { repository, status, configuration, hiddenDeletionIds } =
    useRepository();
  const serialized = useSyncExternalStore(
    (listener) => repository.subscribe(listener),
    () => {
      if (status !== "ready") return "null";
      const indexed = repository.navigationTaskCounts?.(
        todayString(new Date(), configuration?.timezone),
        hiddenDeletionIds,
      );
      if (!repository.cachedInboxCount) return JSON.stringify(indexed ?? null);
      const inboxByView: Record<string, number | null> = {};
      for (const view of views) {
        if (starterViewKind(view) === "inbox")
          inboxByView[view.key] = repository.cachedInboxCount(
            view,
            hiddenDeletionIds,
          );
      }
      return JSON.stringify({
        inbox: indexed?.inbox ?? null,
        upcoming: indexed?.upcoming ?? null,
        inboxByView,
      });
    },
    () => "null",
  );
  return JSON.parse(serialized) as NavigationCounts | null;
}

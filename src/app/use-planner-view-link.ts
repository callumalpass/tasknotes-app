import { useEffect, useState } from "react";

import { plannerViewUrl } from "../domain/planner-link";

import type { TaskRepository } from "../application/ports/task-repository";
import type { TaskView } from "../domain/view";

export function usePlannerViewLink(
  repository: TaskRepository,
  view?: TaskView,
): string | undefined {
  const [collection, setCollection] = useState<{
    viewKey: string;
    id?: string;
  }>();
  const viewKey =
    view?.presentation?.type === "tasknotes.planner" ? view.key : undefined;

  useEffect(() => {
    if (!viewKey) return;
    let active = true;
    void repository.collectionInfo().then(
      (info) => {
        if (active) setCollection({ viewKey, id: info.id });
      },
      () => {
        if (active) setCollection({ viewKey });
      },
    );
    return () => {
      active = false;
    };
  }, [repository, viewKey]);

  return viewKey
    ? plannerViewUrl(
        viewKey,
        collection?.viewKey === viewKey ? collection.id : undefined,
      )
    : undefined;
}

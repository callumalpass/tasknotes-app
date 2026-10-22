import { useEffect, useState } from "react";

import { plannerViewUrl } from "../domain/planner-link";

import type { TaskRepository } from "../application/ports/task-repository";
import type { TaskView } from "../domain/view";

export function usePlannerViewLink(
  repository: TaskRepository,
  view?: TaskView,
): string | undefined {
  const [collection, setCollection] = useState<{
    repository: TaskRepository;
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
        if (active)
          setCollection({
            repository,
            viewKey,
            id: info.collectionId ?? info.id,
          });
      },
      () => {
        if (active) setCollection({ repository, viewKey });
      },
    );
    return () => {
      active = false;
    };
  }, [repository, viewKey]);

  return viewKey &&
    collection?.viewKey === viewKey &&
    collection.repository === repository
    ? plannerViewUrl(viewKey, collection.id)
    : undefined;
}

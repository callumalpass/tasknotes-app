import { useMemo, useSyncExternalStore, type ReactNode } from "react";

import { useRepository } from "./repository-context";
import { TaskRowRelationsContext } from "./use-task-row-relation";

import type { TaskRowRelations } from "../domain/task-row-relations";

/**
 * Rows read subtask counts and open blockers from metadata the repository has
 * already loaded. One subscription serves every row and never starts a read.
 */
export function TaskRowRelationsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { repository, status } = useRepository();
  const serialized = useSyncExternalStore(
    (listener) => repository.subscribe(listener),
    () =>
      status === "ready"
        ? JSON.stringify(repository.taskRowRelations?.() ?? {})
        : "{}",
    () => "{}",
  );
  const relations = useMemo(
    () => JSON.parse(serialized) as TaskRowRelations,
    [serialized],
  );
  return (
    <TaskRowRelationsContext.Provider value={relations}>
      {children}
    </TaskRowRelationsContext.Provider>
  );
}

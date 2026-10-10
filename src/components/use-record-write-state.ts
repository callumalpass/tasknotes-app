import { useCallback, useSyncExternalStore } from "react";
import type {
  RecordWriteTarget,
  TaskRepository,
} from "../application/ports/task-repository";

/** Read-only native save metadata, independent of task visibility in a view. */
export function useRecordWriteState(
  repository: TaskRepository | undefined,
  target: RecordWriteTarget,
) {
  const key = target.kind === "task" ? target.id : target.path;
  const kind = target.kind;
  const snapshot = useCallback(
    () =>
      repository?.writeState?.(
        kind === "task" ? { kind, id: key } : { kind, path: key },
      ),
    [repository, kind, key],
  );
  const subscribe = useCallback(
    (notify: () => void) => repository?.subscribe(notify) ?? (() => {}),
    [repository],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

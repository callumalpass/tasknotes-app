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
  const key = target.kind === "source" ? target.path : target.id;
  const kind = target.kind;
  const snapshot = useCallback(
    () =>
      repository?.writeState?.(
        kind === "source" ? { kind, path: key } : { kind, id: key },
      ),
    [repository, kind, key],
  );
  const subscribe = useCallback(
    (notify: () => void) => repository?.subscribe(notify) ?? (() => {}),
    [repository],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

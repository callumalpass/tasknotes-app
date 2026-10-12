import { useCallback, useMemo, useSyncExternalStore } from "react";
import type {
  RecordWriteRejection,
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

/** The refusal behind a failed save, re-read whenever the repository changes. */
export function useRecordWriteRejection(
  repository: TaskRepository | undefined,
  target: RecordWriteTarget,
): RecordWriteRejection | undefined {
  const key = target.kind === "source" ? target.path : target.id;
  const kind = target.kind;
  // A primitive snapshot keeps useSyncExternalStore stable across reads.
  const snapshot = useCallback(() => {
    const rejection = repository?.writeRejection?.(
      kind === "source" ? { kind, path: key } : { kind, id: key },
    );
    return rejection
      ? `${rejection.changedElsewhere ? 1 : 0}${rejection.message}`
      : undefined;
  }, [repository, kind, key]);
  const subscribe = useCallback(
    (notify: () => void) => repository?.subscribe(notify) ?? (() => {}),
    [repository],
  );
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  return useMemo(
    () =>
      value === undefined
        ? undefined
        : { changedElsewhere: value[0] === "1", message: value.slice(1) },
    [value],
  );
}

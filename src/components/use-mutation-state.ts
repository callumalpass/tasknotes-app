import { useCallback, useSyncExternalStore } from "react";
import {
  idleMutation,
  type TaskMutations,
} from "../application/task-mutations";

export function useMutationState(
  controller: TaskMutations | undefined,
  key: string,
) {
  const subscribe = useCallback(
    (listener: () => void) =>
      controller?.subscribe(key, listener) ?? (() => {}),
    [controller, key],
  );
  const snapshot = useCallback(
    () => controller?.snapshot(key) ?? idleMutation,
    [controller, key],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

import type {
  RecordWriteTarget,
  TaskRepository,
} from "../application/ports/task-repository";
import { useRecordWriteState } from "./use-record-write-state";
import { WriteStatusOverlay } from "./collection-write-status";
import { useRegisterWriteStatus } from "./record-write-status-context";

/** Report the existing record outcome to the workspace's single quiet overlay.
 * Standalone editors use the same presentation without adding in-flow chrome. */
export function RecordWriteNotice({
  repository,
  target,
}: {
  repository: TaskRepository;
  target: RecordWriteTarget;
}) {
  const state = useRecordWriteState(repository, target);
  const registered = useRegisterWriteStatus(target, state);
  if (registered) return null;
  return (
    <WriteStatusOverlay
      repository={repository}
      pending={state === "pending" ? 1 : 0}
      problem={state && state !== "pending" ? { target, state } : undefined}
    />
  );
}

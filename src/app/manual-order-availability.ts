import type { TaskViewExecution } from "../domain/view";

/** A rank plan needs the complete, current ordering scope. */
export function canReorderExecution(execution: TaskViewExecution | null) {
  return Boolean(
    execution &&
    !execution.hasMore &&
    !execution.stale &&
    !execution.hasSkippedRecords,
  );
}

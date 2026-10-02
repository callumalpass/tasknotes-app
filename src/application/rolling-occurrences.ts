import { rollingOccurrenceDates } from "../domain/task-occurrence";
import type { TaskSummary } from "../domain/task";

/** Secondary materialization must not turn an accepted task write into a failure.
 * Adapters retain ownership of locking, identity, persistence and cancellation.
 */
export async function materializeRollingWindow(
  task: TaskSummary,
  materialize: (parentId: string, date: string) => Promise<unknown>,
): Promise<string[]> {
  let dates: string[];
  try {
    dates = rollingOccurrenceDates(task);
  } catch (reason) {
    return [`rolling_occurrence_materialization_failed: ${message(reason)}`];
  }
  const warnings: string[] = [];
  for (const date of dates) {
    try {
      await materialize(task.id, date);
    } catch (reason) {
      warnings.push(
        `rolling_occurrence_materialization_failed: ${date}: ${message(reason)}`,
      );
    }
  }
  return warnings;
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

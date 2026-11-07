import type { TaskNavigationTarget } from "../use-workspace-navigation";
import type { TaskSummary } from "../../domain/task";
import type { TaskViewExecution } from "../../domain/view";

/** Props shared by the list and board presentations of a saved view. */
export interface ViewProps {
  execution: TaskViewExecution;
  onOpen(
    task: TaskSummary,
    occurrenceDate?: string,
    order?: readonly TaskNavigationTarget[],
  ): void;
  onToggle(task: TaskSummary, occurrenceDate?: string): void;
}

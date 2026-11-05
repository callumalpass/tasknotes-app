import { taskDatePart, type TaskSummary } from "./task";

export function effectiveOverdueDate(
  task: Pick<TaskSummary, "due" | "scheduled">,
): string {
  const dates = [taskDatePart(task.scheduled), taskDatePart(task.due)].filter(
    Boolean,
  );
  return dates.sort()[0] ?? "";
}

export function compareOverdueTasks(
  left: TaskSummary,
  right: TaskSummary,
): number {
  return effectiveOverdueDate(left).localeCompare(effectiveOverdueDate(right));
}

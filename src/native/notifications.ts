import type { TaskSummary, UpdateTaskInput } from "../domain/task";
import type { TaskRepository } from "../application/ports/task-repository";

export { desiredTaskTimers } from "../domain/reminder-timers";
export type ReminderAuthority = "none" | "connect";

export function taskUpdateAffectsNotifications(
  input: UpdateTaskInput,
): boolean {
  return [
    "archived",
    "completed",
    "due",
    "reminders",
    "scheduled",
    "status",
  ].some((property) => Object.hasOwn(input, property));
}

export async function reconcileTaskNotifications(
  repository: TaskRepository,
  authority: ReminderAuthority = "none",
): Promise<void> {
  if (authority !== "connect") return;
  if (!repository.reconcileReminders)
    throw new Error("This collection cannot reconcile reminders.");
  return repository.reconcileReminders();
}

export async function syncTaskNotifications(
  repository: TaskRepository,
  _task: TaskSummary,
  authority: ReminderAuthority = "none",
): Promise<void> {
  return reconcileTaskNotifications(repository, authority);
}

export async function removeTaskNotifications(
  repository: TaskRepository,
  _taskId: string,
  authority: ReminderAuthority = "none",
): Promise<void> {
  return reconcileTaskNotifications(repository, authority);
}

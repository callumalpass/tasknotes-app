import { useRepository } from "./repository-context";
import { planRecurringCalendarDrop } from "../domain/calendar-recurrence-drag";

import type { Task, TaskTimeEntry, UpdateTaskInput } from "../domain/task";
import type { RecurringCalendarDrop } from "../domain/calendar-recurrence-drag";
import type { TaskView, TaskViewExecution } from "../domain/view";

export function useCalendarMutations(
  view: TaskView | undefined,
  onRefresh: (execution: TaskViewExecution) => void,
  onRefreshError: (view: TaskView, reason: unknown) => void,
) {
  const { repository, replaceTimeEntries, updateTask } = useRepository();

  function refresh() {
    if (view)
      void repository
        .executeView(view)
        .then(onRefresh, (reason) => onRefreshError(view, reason));
  }

  async function updateCalendarTask(task: Task, input: UpdateTaskInput) {
    await updateTask(task.id, input);
    refresh();
  }

  return {
    updateTask: updateCalendarTask,
    async updateOccurrence(task: Task, drop: RecurringCalendarDrop) {
      await updateCalendarTask(task, planRecurringCalendarDrop(task, drop));
    },
    async replaceTimeEntries(task: Task, entries: TaskTimeEntry[]) {
      await replaceTimeEntries(task.id, entries);
      refresh();
    },
  };
}

import { useRepository } from "./repository-context";
import type { CalendarTaskEdit } from "../domain/calendar-edit";
import type { TaskSummary } from "../domain/task";
import type { TaskView, TaskViewExecution } from "../domain/view";

export function useCalendarMutations(
  view: TaskView | undefined,
  onRefresh: (execution: TaskViewExecution) => void,
  onRefreshError: (view: TaskView, reason: unknown) => void,
) {
  const { repository, editCalendar } = useRepository();
  return {
    async edit(task: TaskSummary, edit: CalendarTaskEdit) {
      await editCalendar(task.id, edit);
      // Refresh query membership/order, not calendar range projection.
      if (view)
        void repository
          .executeView(view)
          .then(onRefresh, (reason) => onRefreshError(view, reason));
    },
  };
}

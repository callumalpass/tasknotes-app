import { t } from "@lingui/core/macro";
import { formatRelativeTaskDate } from "../i18n/presentation";
import { useRepository } from "./repository-context";
import { rememberUndo } from "./undo-history";
import type { CalendarTaskEdit } from "../domain/calendar-edit";
import type { TaskSummary } from "../domain/task";
import type { TaskView, TaskViewExecution } from "../domain/view";

export function useCalendarMutations(
  view: TaskView | undefined,
  onRefresh: (execution: TaskViewExecution) => void,
  onRefreshError: (view: TaskView, reason: unknown) => void,
) {
  const { repository, editCalendar, updateTask } = useRepository();
  return {
    async edit(task: TaskSummary, edit: CalendarTaskEdit) {
      const updated = await editCalendar(task.id, edit);
      if (!task.recurrence && !task.recurrenceParent) {
        const { title } = task;
        const when = updated.scheduled
          ? formatRelativeTaskDate(updated.scheduled)
          : "";
        const earlier = {
          scheduled: task.scheduled ?? null,
          due: task.due ?? null,
          timeEstimate: task.timeEstimate ?? null,
        };
        rememberUndo({
          label: title,
          notice:
            updated.scheduled && updated.scheduled !== task.scheduled
              ? t`Moved “${title}” to ${when}`
              : t`Updated “${title}”`,
          run: () => updateTask(task.id, earlier),
        });
      }
      // Refresh query membership/order, not calendar range projection.
      if (view)
        void repository
          .executeView(view)
          .then(onRefresh, (reason) => onRefreshError(view, reason));
    },
  };
}

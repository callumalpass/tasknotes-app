import { useLingui } from "@lingui/react/macro";
import type { TaskView } from "../domain/view";

export function ViewEmptyState({
  view,
  stale,
}: {
  view: Pick<TaskView, "id" | "presentation">;
  stale?: boolean;
}) {
  const { t } = useLingui();
  const title = stale
    ? t({ message: "No cached tasks for this view." })
    : view.id === "today"
      ? t({ message: "You’re done for today." })
      : view.id === "archive"
        ? t({ message: "No archived tasks here." })
        : view.id === "upcoming"
          ? t({ message: "No upcoming tasks here." })
          : t({ message: "No tasks match this view" });
  const body = stale
    ? t({ message: "Retry this view to check for tasks." })
    : view.id === "archive"
      ? t({
          message:
            "Archived tasks are kept, not deleted. You can restore them from their task menu.",
        })
      : view.id === "upcoming"
        ? t({ message: "Add a Scheduled or Due date to an active task." })
        : view.presentation?.options.create === false
          ? t({ message: "Adjust this view’s filters or choose another view." })
          : t({ message: "Add a task whenever you need to." });
  return (
    <div className="plain-empty task-list-view">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

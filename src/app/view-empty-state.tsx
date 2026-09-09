import type { TaskView } from "../domain/view";

export function ViewEmptyState({
  view,
  stale,
}: {
  view: TaskView;
  stale?: boolean;
}) {
  const title = stale
    ? "No cached tasks for this view."
    : view.id === "today"
      ? "You’re done for today."
      : view.id === "archive"
        ? "No archived tasks here."
        : view.id === "upcoming"
          ? "No upcoming tasks here."
          : "No tasks match this view";
  const body = stale
    ? "Retry this view to check for tasks."
    : view.id === "archive"
      ? "Archived tasks remain searchable. You can restore them from their task menu."
      : view.id === "upcoming"
        ? "Add a Scheduled or Due date to an active task."
        : view.presentation?.options.create === false
          ? "Adjust this view’s filters or choose another view."
          : "Add a task whenever you need to.";
  return (
    <div className="plain-empty task-list-view">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

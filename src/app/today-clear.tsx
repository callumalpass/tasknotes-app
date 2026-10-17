import { formatRelativeTaskDate } from "../domain/task";
import type { TaskSummary } from "../domain/task";
import type { TaskOccurrenceEntry } from "../domain/task-occurrence";

/**
 * Today and Overdue have nothing left. Says so once, then points at what is
 * coming rather than leaving an empty page.
 */
export function TodayClear({
  next,
  loading,
  onOpenTask,
  onOpenUpcoming,
}: {
  next?: TaskOccurrenceEntry;
  /** Hold the follow-up line until the collection has been read. */
  loading: boolean;
  onOpenTask(task: TaskSummary, occurrenceDate?: string): void;
  onOpenUpcoming?(): void;
}) {
  const nextDate = next
    ? formatRelativeTaskDate(
        next.occurrence ? next.date : (next.task.scheduled ?? next.task.due!),
      )
    : "";
  return (
    <div className="today-clear">
      <p className="today-clear-title">Today is clear</p>
      {loading ? null : (
        <p>
          {next ? (
            <>
              <span>Next: </span>
              <button
                className="today-clear-next"
                type="button"
                onClick={() => onOpenTask(next.task, next.occurrence?.date)}
              >
                {next.task.title}
              </button>
              <span className="today-clear-date"> · {nextDate}</span>
            </>
          ) : (
            "Nothing is scheduled after today."
          )}
        </p>
      )}
      {!loading && onOpenUpcoming ? (
        <button
          className="text-action today-clear-upcoming"
          type="button"
          onClick={onOpenUpcoming}
        >
          See Upcoming
        </button>
      ) : null}
    </div>
  );
}

/** A collection with no tasks yet, as opposed to a finished day. */
export function TodayFirstRun() {
  return (
    <div className="plain-empty task-list-view">
      <h2>No tasks yet</h2>
      <p>Add a task to start planning your day.</p>
    </div>
  );
}

import { useMemo, useState } from "react";

import { EmptyState } from "../components/empty-state";
import { LoadingRows } from "../components/loading";
import { TaskRow } from "../components/task-row";
import { dateFromStorage, formatTaskDate, todayString } from "../domain/task";
import {
  occurrenceRange,
  projectUpcomingTasks,
} from "../domain/task-occurrence";
import { useRepository, useTasks } from "./repository-context";

import type { Task } from "../domain/task";

const PAGE_SIZE = 300;

export function UpcomingScreen({
  onOpen,
}: {
  onOpen(task: Task, occurrenceDate?: string): void;
}) {
  const { toggleTask } = useRepository();
  const { tasks, loading, error } = useTasks({ status: "open", limit: 50_000 });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const today = todayString();
  const range = useMemo(() => occurrenceRange(0, 60), []);
  const projection = useMemo(
    () => projectUpcomingTasks(tasks, today, range.end, visibleCount),
    [range.end, tasks, today, visibleCount],
  );

  return (
    <section className="screen" aria-labelledby="upcoming-title">
      <header className="screen-header compact-header">
        <h1 id="upcoming-title">Upcoming</h1>
      </header>
      {error ? (
        <p className="inline-error" role="alert">
          {error.message}
        </p>
      ) : loading ? (
        <LoadingRows count={6} />
      ) : projection.groups.length === 0 ? (
        <EmptyState
          title="Nothing scheduled ahead."
          body="Add a scheduled or due date to a task when it needs a place here."
        />
      ) : (
        <div className="task-groups upcoming-groups">
          {projection.groups.map((group) => (
            <section className="task-section" key={group.date}>
              <div className="section-heading">
                <h2>{formatUpcomingDate(group.date, today)}</h2>
                <span>{group.totalCount}</span>
              </div>
              <div className="task-list">
                {group.tasks.map((entry) => (
                  <TaskRow
                    key={entry.key}
                    task={entry.task}
                    occurrence={entry.occurrence}
                    onOpen={onOpen}
                    onToggle={(item, occurrenceDate) =>
                      void toggleTask(item.id, occurrenceDate)
                    }
                  />
                ))}
              </div>
            </section>
          ))}
          {projection.totalCount > projection.shownCount ? (
            <div className="task-list-more">
              <p>
                Showing {projection.shownCount.toLocaleString()} of{" "}
                {projection.totalCount.toLocaleString()} upcoming tasks.
              </p>
              <button
                className="text-action"
                type="button"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              >
                Show more
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function formatUpcomingDate(value: string, today: string): string {
  const relative = formatTaskDate(value, today);
  if (relative === "Tomorrow") return relative;
  const date = dateFromStorage(value);
  if (!date) return value;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date);
}

import { useMemo } from "react";

import { EmptyState } from "../components/empty-state";
import { LoadingRows } from "../components/loading";
import { TaskRow } from "../components/task-row";
import { dateFromStorage, formatTaskDate, todayString } from "../domain/task";
import { useRepository, useTasks } from "./repository-context";

import type { Task } from "../domain/task";

export function UpcomingScreen({ onOpen }: { onOpen(task: Task): void }) {
  const { toggleTask } = useRepository();
  const { tasks, loading, error } = useTasks({ status: "open", limit: 50_000 });
  const today = todayString();
  const groups = useMemo(() => groupUpcoming(tasks, today), [tasks, today]);

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
      ) : groups.length === 0 ? (
        <EmptyState
          title="Nothing scheduled ahead."
          body="Add a scheduled or due date to a task when it needs a place here."
        />
      ) : (
        <div className="task-groups upcoming-groups">
          {groups.map((group) => (
            <section className="task-section" key={group.date}>
              <div className="section-heading">
                <h2>{formatUpcomingDate(group.date, today)}</h2>
                <span>{group.tasks.length}</span>
              </div>
              <div className="task-list">
                {group.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onOpen={onOpen}
                    onToggle={(item) => void toggleTask(item.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function groupUpcoming(tasks: Task[], today: string) {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const date = task.scheduled ?? task.due;
    if (!date || date <= today) continue;
    const existing = groups.get(date) ?? [];
    existing.push(task);
    groups.set(date, existing);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, grouped]) => ({ date, tasks: grouped }));
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

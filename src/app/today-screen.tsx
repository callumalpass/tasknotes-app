import { useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";

import { EmptyState } from "../components/empty-state";
import { LoadingRows } from "../components/loading";
import { TaskCapture } from "../components/task-capture";
import { TaskRow } from "../components/task-row";
import { todayString } from "../domain/task";
import {
  occurrenceRange,
  projectTodayTasks,
  type TaskOccurrence,
} from "../domain/task-occurrence";
import { useRepository, useTasks } from "./repository-context";

import type { Task } from "../domain/task";

const PAGE_SIZE = 300;

interface TodayEntry {
  key: string;
  task: Task;
  occurrence?: TaskOccurrence;
  date: string;
}

export function TodayScreen({
  onBack,
  onOpen,
}: {
  onBack?(): void;
  onOpen(task: Task, occurrenceDate?: string): void;
}) {
  const { createTask, toggleTask, refreshing, sync, configuration } =
    useRepository();
  const { tasks, loading, error } = useTasks({ status: "all", limit: 50_000 });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const today = todayString();
  const range = useMemo(() => occurrenceRange(30, 0), []);
  const projection = useMemo(
    () => projectTodayTasks(tasks, range.start, today, visibleCount),
    [range.start, tasks, today, visibleCount],
  );

  return (
    <section className="screen" aria-labelledby="today-title">
      {onBack ? (
        <button
          className="back-action view-back-action"
          type="button"
          onClick={onBack}
        >
          <ChevronLeft aria-hidden="true" size={20} />
          Views
        </button>
      ) : null}
      <header className="screen-header">
        <div>
          <p className="eyebrow">{formatFullDate()}</p>
          <h1 id="today-title">Today</h1>
        </div>
        <span className="sync-state">
          {refreshing || sync.state === "syncing"
            ? sync.mode === "replicated"
              ? "Syncing"
              : sync.mode === "live"
                ? "Refreshing"
                : "Checking files"
            : sync.mode === "local"
              ? "On this device"
              : sync.state === "offline"
                ? "Offline"
                : sync.state === "issues"
                  ? "Sync issue"
                  : sync.mode === "live"
                    ? "Connected"
                    : "Up to date"}
        </span>
      </header>

      <TaskCapture configuration={configuration} createTask={createTask} />
      {error ? (
        <p className="inline-error" role="alert">
          {error.message}
        </p>
      ) : null}

      {loading ? (
        <LoadingRows />
      ) : projection.totalCount === 0 ? (
        <EmptyState
          title="Nothing is waiting."
          body="Add something above. It will remain available offline."
        />
      ) : (
        <div className="task-groups">
          <TaskSection
            label="Overdue"
            tasks={projection.overdue}
            onOpen={onOpen}
            onToggle={(task, occurrenceDate) =>
              void toggleTask(task.id, occurrenceDate)
            }
          />
          <TaskSection
            label="Today"
            tasks={projection.today}
            onOpen={onOpen}
            onToggle={(task, occurrenceDate) =>
              void toggleTask(task.id, occurrenceDate)
            }
          />
          <TaskSection
            label="Inbox"
            tasks={projection.inbox}
            onOpen={onOpen}
            onToggle={(task, occurrenceDate) =>
              void toggleTask(task.id, occurrenceDate)
            }
          />
          {projection.totalCount > projection.shownCount ? (
            <div className="task-list-more">
              <p>
                Showing {projection.shownCount.toLocaleString()} of{" "}
                {projection.totalCount.toLocaleString()} tasks.
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

function TaskSection({
  label,
  tasks,
  onOpen,
  onToggle,
}: {
  label: string;
  tasks: TodayEntry[];
  onOpen(task: Task, occurrenceDate?: string): void;
  onToggle(task: Task, occurrenceDate?: string): void;
}) {
  if (!tasks.length) return null;
  return (
    <section className="task-section" aria-labelledby={`section-${label}`}>
      <div className="section-heading">
        <h2 id={`section-${label}`}>{label}</h2>
        <span>{tasks.length}</span>
      </div>
      <div className="task-list">
        {tasks.map((entry) => (
          <TaskRow
            key={entry.key}
            task={entry.task}
            occurrence={entry.occurrence}
            onOpen={onOpen}
            onToggle={onToggle}
          />
        ))}
      </div>
    </section>
  );
}

function formatFullDate(): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

import { useMemo, useState, type FormEvent } from "react";

import { EmptyState } from "../components/empty-state";
import { LoadingRows } from "../components/loading";
import { TaskRow } from "../components/task-row";
import { todayString } from "../domain/task";
import { useRepository, useTasks } from "./repository-context";

import type { Task } from "../domain/task";

const PAGE_SIZE = 300;

export function TodayScreen({ onOpen }: { onOpen(task: Task): void }) {
  const { createTask, toggleTask, refreshing, sync } = useRepository();
  const { tasks, loading, error } = useTasks({ status: "open", limit: 50_000 });
  const [title, setTitle] = useState("");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const today = todayString();
  const relevantTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const date = task.scheduled ?? task.due;
        return !date || date <= today;
      }),
    [tasks, today],
  );
  const visibleTasks = useMemo(
    () => relevantTasks.slice(0, visibleCount),
    [relevantTasks, visibleCount],
  );
  const groups = useMemo(
    () => groupTasks(visibleTasks, today),
    [today, visibleTasks],
  );

  async function capture(event: FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value || capturing) return;
    setCapturing(true);
    setCaptureError(null);
    try {
      await createTask({ title: value });
      setTitle("");
    } catch (reason) {
      setCaptureError(
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      setCapturing(false);
    }
  }

  return (
    <section className="screen" aria-labelledby="today-title">
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

      <form className="quick-capture" onSubmit={(event) => void capture(event)}>
        <span aria-hidden="true" className="capture-plus">
          +
        </span>
        <label className="visually-hidden" htmlFor="quick-task">
          New task title
        </label>
        <input
          id="quick-task"
          autoComplete="off"
          enterKeyHint="done"
          placeholder="Add a task"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        {title.trim() ? (
          <button disabled={capturing} type="submit">
            {capturing ? "Adding" : "Add"}
          </button>
        ) : null}
      </form>
      {captureError ? (
        <p className="inline-error" role="alert">
          {captureError}
        </p>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {error.message}
        </p>
      ) : null}

      {loading ? (
        <LoadingRows />
      ) : relevantTasks.length === 0 ? (
        <EmptyState
          title="Nothing is waiting."
          body="Add something above. It will remain available offline."
        />
      ) : (
        <div className="task-groups">
          <TaskSection
            label="Overdue"
            tasks={groups.overdue}
            onOpen={onOpen}
            onToggle={(task) => void toggleTask(task.id)}
          />
          <TaskSection
            label="Today"
            tasks={groups.today}
            onOpen={onOpen}
            onToggle={(task) => void toggleTask(task.id)}
          />
          <TaskSection
            label="Inbox"
            tasks={groups.inbox}
            onOpen={onOpen}
            onToggle={(task) => void toggleTask(task.id)}
          />
          {relevantTasks.length > visibleTasks.length ? (
            <div className="task-list-more">
              <p>
                Showing {visibleTasks.length.toLocaleString()} of{" "}
                {relevantTasks.length.toLocaleString()} tasks.
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
  tasks: Task[];
  onOpen(task: Task): void;
  onToggle(task: Task): void;
}) {
  if (!tasks.length) return null;
  return (
    <section className="task-section" aria-labelledby={`section-${label}`}>
      <div className="section-heading">
        <h2 id={`section-${label}`}>{label}</h2>
        <span>{tasks.length}</span>
      </div>
      <div className="task-list">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            onOpen={onOpen}
            onToggle={onToggle}
          />
        ))}
      </div>
    </section>
  );
}

function groupTasks(tasks: Task[], today: string) {
  const result: Record<"overdue" | "today" | "inbox", Task[]> = {
    overdue: [],
    today: [],
    inbox: [],
  };
  for (const task of tasks) {
    const date = task.scheduled ?? task.due;
    if (!date) result.inbox.push(task);
    else if (date < today) result.overdue.push(task);
    else if (date === today) result.today.push(task);
  }
  return result;
}

function formatFullDate(): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

import { ArrowLeft } from "lucide-react";

import { EmptyState } from "../components/empty-state";
import { LoadingRows } from "../components/loading";
import { TaskRow } from "../components/task-row";
import { useRepository, useTasks } from "./repository-context";

import type { Task } from "../domain/task";

export function ArchiveScreen({
  onBack,
  onOpen,
}: {
  onBack(): void;
  onOpen(task: Task): void;
}) {
  const { toggleTask } = useRepository();
  const { tasks, loading, error } = useTasks({
    status: "all",
    archived: "only",
    limit: 50_000,
  });

  return (
    <section className="screen archive-screen" aria-labelledby="archive-title">
      <header className="screen-header compact-header detail-header">
        <button
          aria-label="Back"
          className="icon-action"
          type="button"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" size={21} strokeWidth={1.7} />
        </button>
        <div>
          <h1 id="archive-title">Archive</h1>
          <p>{tasks.length ? `${tasks.length} tasks` : "Completed history"}</p>
        </div>
      </header>
      {error ? (
        <p className="inline-error" role="alert">
          {error.message}
        </p>
      ) : loading ? (
        <LoadingRows count={4} />
      ) : tasks.length ? (
        <div className="task-list archive-list">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onOpen={onOpen}
              onToggle={(item) => void toggleTask(item.id)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="Nothing archived."
          body="Archived tasks remain Markdown records and can be restored here."
        />
      )}
    </section>
  );
}

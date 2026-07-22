import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "../components/empty-state";
import { LoadingRows } from "../components/loading";
import { TaskRow } from "../components/task-row";
import { useRepository, useTasks } from "./repository-context";

import type { Task } from "../domain/task";

export function SearchScreen({ onOpen }: { onOpen(task: Task): void }) {
  const [query, setQuery] = useState("");
  const deferred = useDebounced(query, 160);
  const { toggleTask } = useRepository();
  const { tasks, loading } = useTasks({
    status: "all",
    search: deferred,
    limit: 300,
  });
  const searching = query.trim().length > 0;

  return (
    <section className="screen" aria-labelledby="search-title">
      <header className="screen-header compact-header">
        <h1 id="search-title">Search</h1>
      </header>
      <div className="search-field">
        <Search aria-hidden="true" size={19} strokeWidth={1.7} />
        <label className="visually-hidden" htmlFor="task-search">
          Search tasks
        </label>
        <input
          id="task-search"
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="Tasks, tags, projects"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button
            aria-label="Clear search"
            type="button"
            onClick={() => setQuery("")}
          >
            <X aria-hidden="true" size={19} strokeWidth={1.7} />
          </button>
        ) : null}
      </div>
      {!searching ? (
        <BrowseFields tasks={tasks} onChoose={setQuery} />
      ) : loading ? (
        <LoadingRows count={4} />
      ) : tasks.length ? (
        <div className="task-list search-results">
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
          title="No tasks matched."
          body="Try fewer words or another spelling."
        />
      )}
    </section>
  );
}

function BrowseFields({
  tasks,
  onChoose,
}: {
  tasks: Task[];
  onChoose(value: string): void;
}) {
  const groups = useMemo(
    () => [
      { label: "Projects", prefix: "+", values: collect(tasks, "projects") },
      { label: "Contexts", prefix: "@", values: collect(tasks, "contexts") },
      {
        label: "Tags",
        prefix: "#",
        values: collect(tasks, "tags").filter((value) => value !== "task"),
      },
    ],
    [tasks],
  );
  const available = groups.filter((group) => group.values.length);
  if (!available.length)
    return (
      <EmptyState
        title="Find a task."
        body="Search titles, notes, projects, contexts, and tags."
      />
    );
  return (
    <div className="browse-fields">
      {available.map((group) => (
        <section key={group.label}>
          <h2>{group.label}</h2>
          <div>
            {group.values.map((value) => (
              <button key={value} type="button" onClick={() => onChoose(value)}>
                <span aria-hidden="true">{group.prefix}</span>
                {cleanField(value)}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function collect(tasks: Task[], field: "tags" | "contexts" | "projects") {
  return [
    ...new Set(tasks.flatMap((task) => task[field]).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
}

function cleanField(value: string): string {
  return value.replace(/^#/, "").replace(/^\[\[|\]\]$/g, "");
}

function useDebounced<T>(value: T, delay: number): T {
  const [deferred, setDeferred] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDeferred(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);
  return deferred;
}

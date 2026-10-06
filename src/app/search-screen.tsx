import { useLingui, Trans } from "@lingui/react/macro";
import { countLabel } from "../i18n/default-labels";
import { ArrowLeft, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "../components/empty-state";
import { PersonSetupLink } from "../components/person-setup-link";
import { LoadingRows } from "../components/loading";
import { taskCompletion } from "../domain/task-completion";
import { linkDisplayLabel } from "../domain/completion";
import { BoundedList } from "../components/bounded-list";
import { TaskRow } from "../components/task-row";
import { useRepository, useTaskSearch } from "./repository-context";
import { searchMatchContext } from "./search-match-context";
import { usePeople } from "./use-people";

import type { TaskSummary } from "../domain/task";

export function SearchScreen({
  onBack,
  onOpen,
}: {
  onBack?: () => void;
  onOpen(task: TaskSummary): void;
}) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [assignedToMe, setAssignedToMe] = useState(false);
  const people = usePeople(assignedToMe);
  const personPath =
    assignedToMe && people.directory?.current.status === "linked"
      ? people.directory.current.personPath
      : undefined;
  const peopleBlocked = assignedToMe && personPath === undefined;
  const deferred = useDebounced(query, 160);
  const { setTaskCompletion } = useRepository();
  const [limit, setLimit] = useState(300);
  const {
    tasks: results,
    loading,
    refreshing,
    error,
    stale,
    retry,
  } = useTaskSearch({
    status: "all",
    search: deferred,
    limit: peopleBlocked ? 0 : limit + 1,
    ...(personPath ? { assignedTo: personPath } : {}),
  });
  const tasks = results.slice(0, limit).map((result) => result.task);
  const bodyMatches = new Map(
    results.map((result) => [result.task.id, result.bodyMatches]),
  );
  const hasMore = results.length > limit;
  const searching = assignedToMe || query.trim().length > 0;
  const waiting = query !== deferred;
  const chooseQuery = (value: string) => {
    setQuery(value);
    setLimit(300);
  };
  const renderTask = (task: TaskSummary) => (
    <TaskRow
      key={task.id}
      task={task}
      supportingText={searchMatchContext(
        task,
        deferred,
        bodyMatches.get(task.id) ?? [],
      )}
      onOpen={onOpen}
      onToggle={(item) =>
        setTaskCompletion({ id: item.id, completed: !taskCompletion(item) })
      }
    />
  );

  return (
    <section className="screen" aria-labelledby="search-title">
      <header className="screen-header compact-header detail-header search-header">
        {onBack ? (
          <button
            aria-label={t({ message: "Back" })}
            className="icon-action"
            title={t({ message: "Back" })}
            type="button"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" size={21} strokeWidth={1.7} />
          </button>
        ) : null}
        <div>
          <h1 id="search-title">
            <Trans>Search</Trans>
          </h1>
          <p>
            <Trans>Across this collection</Trans>
          </p>
        </div>
      </header>
      <div className="search-field">
        <Search aria-hidden="true" size={19} strokeWidth={1.7} />
        <label className="visually-hidden" htmlFor="task-search">
          <Trans>Search tasks</Trans>
        </label>
        <input
          id="task-search"
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          placeholder={t({ message: "Tasks, tags, projects" })}
          type="search"
          value={query}
          onChange={(event) => chooseQuery(event.target.value)}
        />
        {query ? (
          <button
            aria-label={t({ message: "Clear search" })}
            title={t({ message: "Clear search" })}
            type="button"
            onClick={() => chooseQuery("")}
          >
            <X aria-hidden="true" size={19} strokeWidth={1.7} />
          </button>
        ) : null}
      </div>
      {people.supported && (
        <label className="assigned-to-me-filter">
          <input
            type="checkbox"
            checked={assignedToMe}
            onChange={(event) => {
              setAssignedToMe(event.target.checked);
              setLimit(300);
            }}
          />
          <Trans>Assigned to me</Trans>
        </label>
      )}
      {!peopleBlocked && !waiting && error ? (
        <div className="operation-error-notice" role="alert">
          <p>
            <Trans>Search could not be loaded. {error.message}</Trans>
          </p>
          {stale ? (
            <p>
              <Trans>Previously loaded results may be out of date.</Trans>
            </p>
          ) : null}
          <button type="button" onClick={retry}>
            <Trans>Retry search</Trans>
          </button>
        </div>
      ) : null}
      {peopleBlocked ? (
        <div
          className="operation-error-notice"
          role={people.error ? "alert" : "status"}
        >
          <p>
            {people.error
              ? t`Your person identity could not be loaded. ${people.error.message}`
              : !people.directory
                ? t({ message: "Loading your person identity…" })
                : people.directory.current.status === "ambiguous"
                  ? t`Several person records match your account: ${people.directory.current.paths.join(", ")}. Resolve those duplicates before filtering tasks.`
                  : people.directory.current.status === "invalid"
                    ? t`Your person record needs fixing before filtering tasks: ${people.directory.current.paths.join(", ")}.`
                    : t({
                        message:
                          "Link your account to a person record before using Assigned to me.",
                      })}
          </p>
          <div className="people-actions">
            {people.directory?.settingsUrl && (
              <PersonSetupLink
                href={people.directory.settingsUrl}
                onOpen={people.openedSettings}
              />
            )}
            <button
              className="people-action"
              type="button"
              onClick={people.retry}
            >
              <RefreshCw size={18} aria-hidden="true" />
              <Trans>Reload people</Trans>
            </button>
          </div>
        </div>
      ) : waiting || (loading && !error) ? (
        <LoadingRows count={4} />
      ) : error && !tasks.length ? null : !searching ? (
        <>
          <BrowseFields tasks={tasks} onChoose={chooseQuery} />
          {hasMore ? (
            <p role="status">
              <Trans>
                Suggestions from the first {limit} tasks. Search to find others.
              </Trans>
            </p>
          ) : null}
        </>
      ) : tasks.length ? (
        <>
          <p className="search-result-count" role="status">
            {refreshing
              ? t({ message: "Refreshing results…" })
              : `${hasMore ? t`${tasks.length}+ tasks` : countLabel(tasks.length, "task")}${stale ? t({ message: " — previously loaded" }) : ""}`}
          </p>
          <div className="task-list search-results">
            {tasks.length > 100 ? (
              <BoundedList
                items={tasks}
                getKey={(task) => task.id}
                renderItem={renderTask}
              />
            ) : (
              tasks.map(renderTask)
            )}
          </div>
          {hasMore || refreshing ? (
            <button
              className="text-action view-pagination-action"
              type="button"
              disabled={refreshing}
              onClick={() => setLimit((value) => value + 300)}
            >
              {refreshing
                ? t({ message: "Loading more…" })
                : t({ message: "Show more results" })}
            </button>
          ) : null}
        </>
      ) : (
        <EmptyState
          title={
            assignedToMe
              ? t({ message: "No matching tasks assigned to you." })
              : t({ message: "No tasks matched." })
          }
          body={
            assignedToMe
              ? t({ message: "Assignments use your linked person record." })
              : t({ message: "Try fewer words or another spelling." })
          }
        />
      )}
    </section>
  );
}

function BrowseFields({
  tasks,
  onChoose,
}: {
  tasks: TaskSummary[];
  onChoose(value: string): void;
}) {
  const { t } = useLingui();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const groups = useMemo(
    () => [
      {
        label: t({ message: "Projects" }),
        prefix: "+",
        values: collect(tasks, "projects"),
      },
      {
        label: t({ message: "Contexts" }),
        prefix: "@",
        values: collect(tasks, "contexts"),
      },
      {
        label: t({ message: "Tags" }),
        prefix: "#",
        values: collect(tasks, "tags").filter((value) => value !== "task"),
      },
    ],
    [t, tasks],
  );
  const available = groups.filter((group) => group.values.length);
  if (!available.length)
    return (
      <EmptyState
        title={t({ message: "Find a task." })}
        body={t({
          message: "Search titles, notes, projects, contexts, and tags.",
        })}
      />
    );
  return (
    <div className="browse-fields">
      {available.map((group) => (
        <section key={group.label}>
          <h2>{group.label}</h2>
          <div>
            {group.values
              .slice(0, expandedGroups.has(group.label) ? undefined : 4)
              .map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onChoose(value)}
                >
                  <span aria-hidden="true">{group.prefix}</span>
                  {cleanField(value)}
                </button>
              ))}
            {group.values.length > 4 ? (
              <button
                className="browse-fields-more"
                type="button"
                onClick={() =>
                  setExpandedGroups((current) => {
                    const next = new Set(current);
                    if (next.has(group.label)) next.delete(group.label);
                    else next.add(group.label);
                    return next;
                  })
                }
              >
                {expandedGroups.has(group.label)
                  ? t({ message: "Show fewer" })
                  : t`Show all ${group.values.length}`}
              </button>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}

function collect(
  tasks: TaskSummary[],
  field: "tags" | "contexts" | "projects",
) {
  const counts = new Map<string, number>();
  for (const value of tasks.flatMap((task) => task[field]).filter(Boolean))
    counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .sort(
      ([left, leftCount], [right, rightCount]) =>
        rightCount - leftCount || left.localeCompare(right),
    )
    .map(([value]) => value);
}

function cleanField(value: string): string {
  return linkDisplayLabel(value.replace(/^#/, ""));
}

function useDebounced<T>(value: T, delay: number): T {
  const [deferred, setDeferred] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDeferred(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);
  return deferred;
}

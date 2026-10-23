import { useLingui } from "@lingui/react/macro";
import { countLabel } from "../i18n/default-labels";
import { Trans } from "@lingui/react/macro";
import { t as translate } from "@lingui/core/macro";
import {
  ArrowLeft,
  FileText,
  History,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "../components/empty-state";
import { PersonSetupLink } from "../components/person-setup-link";
import { LoadingRows } from "../components/loading";
import { taskCompletion } from "../domain/task-completion";
import { linkDisplayLabel } from "../domain/completion";
import { BoundedList } from "../components/bounded-list";
import { TaskRow } from "../components/task-row";
import { useRepository, useTaskSearch } from "./repository-context";
import { searchMatchContext } from "./search-match-context";
import {
  clearHistory,
  forgetHistory,
  historyScope,
  readHistory,
  rememberHistory,
  type HistoryKind,
} from "./search-history";
import { usePeople } from "./use-people";

import type { Task, TaskSummary } from "../domain/task";

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
  const history = useSearchHistory();
  const inputRef = useRef<HTMLInputElement>(null);
  // A query that settled with results is worth offering again, including when
  // the person simply leaves Search after reading them.
  const settledQuery =
    !waiting && !loading && tasks.length ? deferred.trim() : "";
  const lastSettled = useRef("");
  useEffect(() => {
    if (!query.trim()) lastSettled.current = "";
    else if (settledQuery) lastSettled.current = settledQuery;
  }, [query, settledQuery]);
  const rememberSearch = history.rememberSearch;
  useEffect(
    () => () => {
      if (lastSettled.current) rememberSearch(lastSettled.current);
    },
    [rememberSearch],
  );
  const openResult = (task: TaskSummary) => {
    if (deferred.trim()) rememberSearch(deferred);
    onOpen(task);
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
      onOpen={openResult}
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
          ref={inputRef}
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          placeholder={t({ message: "Tasks, tags, projects" })}
          type="search"
          value={query}
          onChange={(event) => chooseQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing)
              rememberSearch(query);
          }}
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
              ? translate({
                  message:
                    "Your person record could not be loaded. Check your connection, then reload people to try again.",
                })
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
          <SearchHistory
            searches={history.searches}
            tasks={history.tasks}
            onChoose={chooseQuery}
            onClear={(kind) => {
              history.clear(kind);
              inputRef.current?.focus();
            }}
            onOpen={onOpen}
          />
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

function useSearchHistory() {
  const { pendingDeletion, repository, status } = useRepository();
  const [scope, setScope] = useState<string>();
  const [searches, setSearches] = useState<string[]>([]);
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const scopeRef = useRef<string>(undefined);

  useEffect(() => {
    if (status !== "ready") return;
    let active = true;
    void repository
      .collectionInfo()
      .then((info) => {
        if (!active) return;
        const next = historyScope(info);
        scopeRef.current = next;
        setScope(next);
        setSearches(readHistory("searches", next));
        setTaskIds(readHistory("tasks", next));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [repository, status]);

  // Opened tasks are stored by ID and read fresh, so renamed tasks show their
  // current title and deleted ones drop out of the history.
  useEffect(() => {
    if (!scope || !taskIds.length) return;
    let active = true;
    void Promise.all(
      taskIds.map((id) =>
        repository.get(id).then(
          (task) => ({ id, task }),
          () => ({ id, task: undefined }),
        ),
      ),
    ).then((results) => {
      if (!active) return;
      const missing = results
        .filter((result) => result.task === null)
        .map((result) => result.id);
      if (missing.length) forgetHistory("tasks", scope, missing);
      setTasks(results.flatMap((result) => (result.task ? [result.task] : [])));
    });
    return () => {
      active = false;
    };
  }, [repository, scope, taskIds]);

  const rememberSearch = useCallback((value: string) => {
    if (scopeRef.current)
      setSearches(rememberHistory("searches", scopeRef.current, value));
  }, []);
  const clear = useCallback((kind: HistoryKind) => {
    if (!scopeRef.current) return;
    clearHistory(kind, scopeRef.current);
    if (kind === "searches") setSearches([]);
    else setTaskIds([]);
  }, []);

  return {
    searches,
    tasks: tasks.filter(
      (task) => taskIds.includes(task.id) && task.id !== pendingDeletion?.id,
    ),
    rememberSearch,
    clear,
  };
}

function SearchHistory({
  searches,
  tasks,
  onChoose,
  onClear,
  onOpen,
}: {
  searches: string[];
  tasks: Task[];
  onChoose(value: string): void;
  onClear(kind: HistoryKind): void;
  onOpen(task: TaskSummary): void;
}) {
  if (!searches.length && !tasks.length) return null;
  return (
    <div className="search-history">
      {searches.length ? (
        <section aria-labelledby="recent-searches-title">
          <header>
            <h2 id="recent-searches-title">
              <Trans>Recent searches</Trans>
            </h2>
            <button
              aria-label={translate({ message: "Clear recent searches" })}
              type="button"
              onClick={() => onClear("searches")}
            >
              <Trans>Clear</Trans>
            </button>
          </header>
          <ul>
            {searches.map((value) => (
              <li key={value}>
                <button type="button" onClick={() => onChoose(value)}>
                  <History aria-hidden="true" size={16} strokeWidth={1.7} />
                  <span>{value}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {tasks.length ? (
        <section aria-labelledby="recent-tasks-title">
          <header>
            <h2 id="recent-tasks-title">
              <Trans>Recently opened</Trans>
            </h2>
            <button
              aria-label={translate({ message: "Clear recently opened tasks" })}
              type="button"
              onClick={() => onClear("tasks")}
            >
              <Trans>Clear</Trans>
            </button>
          </header>
          <ul>
            {tasks.map((task) => (
              <li key={task.id}>
                <button type="button" onClick={() => onOpen(task)}>
                  <FileText aria-hidden="true" size={16} strokeWidth={1.7} />
                  <span>{task.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
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

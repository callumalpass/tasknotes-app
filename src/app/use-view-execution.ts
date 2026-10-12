import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { startupTiming } from "../observability/startup-timing";
import { ViewQuerySession } from "../application/view-query-session";
import type { TaskRepository } from "../application/ports/task-repository";
import type { TaskView, TaskViewExecution } from "../domain/view";
import { useRepositoryRevision } from "./repository-context";
import { shareUnchangedRows } from "./view-execution-sharing";

/** Data notifications for one edit (the local write, its echo, a catalog
 * refresh) arrive within a few hundred milliseconds. Re-query once for them. */
export const VIEW_REFRESH_COALESCE_MS = 150;

export function useViewExecution(
  repository: TaskRepository,
  selected: TaskView | undefined,
  viewKey: string | undefined,
  sortOrderField: string,
  reconcile: (execution: TaskViewExecution, key: string) => void,
) {
  const sessionRef = useRef<ViewQuerySession | null>(null);
  const queryRowsRef = useRef(new Map<string, number>());
  const renderEnd = useRef<(() => void) | undefined>(undefined);
  const [paging, setPaging] = useState({
    key: "",
    available: false,
    used: false,
  });
  const scope = `view:${viewKey ?? "catalog"}` as const;
  const revision = useRepositoryRevision(scope);
  const [settled, setSettled] = useState({ scope, revision });
  // Opening another view queries at once; only repeat notifications wait.
  if (settled.scope !== scope) setSettled({ scope, revision });
  const settledRevision = settled.revision;
  useEffect(() => {
    if (revision === settledRevision) return;
    const timer = window.setTimeout(
      () => setSettled({ scope, revision }),
      VIEW_REFRESH_COALESCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [revision, scope, settledRevision]);
  const [execution, setExecution] = useState<TaskViewExecution | null>(null);
  const shown = useRef<TaskViewExecution | null>(null);
  useEffect(() => {
    shown.current = execution;
  }, [execution]);
  const [executionError, setExecutionError] = useState<{
    key: string;
    reason: unknown;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [refreshingExecution, setRefreshingExecution] = useState<string | null>(
    null,
  );
  // A re-query behind a current result for the same view. It must not change
  // what is on screen: no loading state, no busy controls, no stale flash.
  const [revalidatingExecution, setRevalidatingExecution] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!viewKey || !selected) return;
    const executionKey = `${selected.key}:${selected.source.revision}`;
    const timing = startupTiming(repository);
    const endQuery = timing?.begin("first_query");
    const session = new ViewQuerySession(
      repository,
      selected,
      {
        result: (result) => {
          setExecution((current) => {
            // A replacement session's cached first paint can predate what is
            // already on screen (for example the edit that caused this read).
            if (
              result.stale &&
              current &&
              !current.stale &&
              current.view.key === result.view.key
            )
              return current;
            return shareUnchangedRows(current, result);
          });
          if (!result.stale) {
            endQuery?.();
            if (!timing?.has("first_render"))
              renderEnd.current ??= timing?.begin("first_render");
            if (queryRowsRef.current.get(selected.key) !== Infinity)
              queryRowsRef.current.set(selected.key, result.rows.length);
            reconcile(result, selected.key);
          }
          setExecutionError(null);
        },
        error: (reason) => setExecutionError({ key: selected.key, reason }),
        pending: (pending, phase) => {
          const current = shown.current;
          const background =
            phase === "start" &&
            current !== null &&
            !current.stale &&
            current.view.key === selected.key;
          setRefreshingExecution(pending && !background ? executionKey : null);
          setRevalidatingExecution(pending && background ? executionKey : null);
          setPaging((previous) => ({
            key: selected.key,
            available: session.canLoadMore,
            used:
              session.canLoadMore ||
              (previous.key === selected.key && previous.used),
          }));
        },
      },
      queryRowsRef.current.get(selected.key) ?? 0,
    );
    sessionRef.current = session;
    void session.start();
    return () => {
      if (sessionRef.current === session) sessionRef.current = null;
      session.close();
    };
  }, [
    sortOrderField,
    reconcile,
    repository,
    selected,
    viewKey,
    settledRevision,
    retry,
  ]);

  useLayoutEffect(() => {
    if (!execution || execution.stale || !renderEnd.current) return;
    renderEnd.current();
    renderEnd.current = undefined;
    startupTiming(repository)?.report();
  }, [execution, repository]);

  const currentSession = useCallback(() => sessionRef.current, []);

  // Commands may capture the current session before an await; never redirect a
  // creation refresh onto a newer view's session after navigation.
  return {
    currentSession,
    rememberAllRows: (key: string) => queryRowsRef.current.set(key, Infinity),
    retryExecution: () => setRetry((attempt) => attempt + 1),
    execution,
    setExecution,
    executionError,
    setExecutionError,
    refreshingExecution,
    revalidatingExecution,
    paging,
  };
}

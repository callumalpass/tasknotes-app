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
  const revision = useRepositoryRevision(`view:${viewKey ?? "catalog"}`);
  const [execution, setExecution] = useState<TaskViewExecution | null>(null);
  const [executionError, setExecutionError] = useState<{
    key: string;
    reason: unknown;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [refreshingExecution, setRefreshingExecution] = useState<string | null>(
    null,
  );

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
          setExecution(result);
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
        pending: (pending) => {
          setRefreshingExecution(pending ? executionKey : null);
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
    revision,
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
    paging,
  };
}

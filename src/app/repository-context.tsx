import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { IndexedMarkdownRepository } from "../storage/repository";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import {
  reconcileTaskNotifications,
  removeTaskNotifications,
  syncTaskNotifications,
} from "../native/notifications";

import type {
  CreateTaskInput,
  Task,
  TaskListQuery,
  TaskStats,
  TaskTimeEntry,
  UpdateTaskInput,
} from "../domain/task";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type {
  CollectionInfo,
  RefreshResult,
  RepositorySyncIssue,
  RepositorySyncStatus,
  TaskRepository,
} from "../storage/repository";

type StorageStatus = "opening" | "ready" | "error";

interface RepositoryContextValue {
  repository: TaskRepository;
  status: StorageStatus;
  error: Error | null;
  refreshing: boolean;
  lastRefresh: RefreshResult | null;
  sync: RepositorySyncStatus;
  syncIssues: RepositorySyncIssue[];
  version: number;
  configuration: TaskCollectionConfiguration;
  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(id: string, input: UpdateTaskInput): Promise<Task>;
  toggleTask(id: string, occurrenceDate?: string): Promise<Task>;
  skipTask(id: string, occurrenceDate: string): Promise<Task>;
  startTimeTracking(id: string, description?: string): Promise<Task>;
  stopTimeTracking(id: string): Promise<Task>;
  replaceTimeEntries(id: string, entries: TaskTimeEntry[]): Promise<Task>;
  removeTimeEntry(id: string, index: number): Promise<Task>;
  setTaskArchived(id: string, archived: boolean): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  refresh(): Promise<RefreshResult>;
  resolveSyncIssue(id: string, resolution: "local" | "remote"): Promise<void>;
}

const RepositoryContext = createContext<RepositoryContextValue | null>(null);

export function RepositoryProvider({
  children,
  repository: supplied,
}: {
  children: ReactNode;
  repository?: TaskRepository;
}) {
  const [repository] = useState<TaskRepository>(
    () => supplied ?? new IndexedMarkdownRepository(),
  );
  const [status, setStatus] = useState<StorageStatus>("opening");
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<RefreshResult | null>(null);
  const [sync, setSync] = useState<RepositorySyncStatus>({
    mode: "local",
    state: "local",
    pending: 0,
    issues: 0,
  });
  const [syncIssues, setSyncIssues] = useState<RepositorySyncIssue[]>([]);
  const [version, setVersion] = useState(0);
  const [configuration, setConfiguration] =
    useState<TaskCollectionConfiguration>(defaultTaskCollectionConfiguration);
  const refreshInFlight = useRef<Promise<RefreshResult> | null>(null);

  const bump = useCallback(() => setVersion((value) => value + 1), []);
  const loadSync = useCallback(async () => {
    const [nextStatus, nextIssues] = await Promise.all([
      repository.syncStatus(),
      repository.syncIssues(),
    ]);
    setSync(nextStatus);
    setSyncIssues(nextIssues);
  }, [repository]);
  const refresh = useCallback(() => {
    if (refreshInFlight.current) return refreshInFlight.current;
    setRefreshing(true);
    const run = repository
      .refresh()
      .then((result) => {
        setLastRefresh(result);
        setError(null);
        bump();
        void loadSync();
        return result;
      })
      .catch((reason: unknown) => {
        const next = asError(reason);
        setError(next);
        throw next;
      })
      .finally(() => {
        refreshInFlight.current = null;
        setRefreshing(false);
      });
    refreshInFlight.current = run;
    return run;
  }, [bump, loadSync, repository]);

  useEffect(() => {
    let active = true;
    repository
      .initialize()
      .then(async () => {
        const nextConfiguration = await repository.taskConfiguration();
        if (!active) return;
        setConfiguration(nextConfiguration);
        setStatus("ready");
        void loadSync();
        void reconcileTaskNotifications(repository).catch(() => undefined);
        void refresh().catch(() => undefined);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(asError(reason));
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [loadSync, refresh, repository]);

  useEffect(() => {
    if (!repository.subscribe) return;
    return repository.subscribe(() => {
      bump();
      void loadSync();
    });
  }, [bump, loadSync, repository]);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      const handle = CapacitorApp.addListener(
        "appStateChange",
        ({ isActive }) => {
          if (isActive && status === "ready")
            void refresh().catch(() => undefined);
        },
      );
      return () => void handle.then((listener) => listener.remove());
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible" && status === "ready")
        void refresh().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh, status]);

  const createTask = useCallback(
    async (input: CreateTaskInput) => {
      const task = await repository.create(input);
      bump();
      void syncTaskNotifications(task).catch(() => undefined);
      return task;
    },
    [bump, repository],
  );
  const updateTask = useCallback(
    async (id: string, input: UpdateTaskInput) => {
      const task = await repository.update(id, input);
      bump();
      void syncTaskNotifications(task).catch(() => undefined);
      return task;
    },
    [bump, repository],
  );
  const toggleTask = useCallback(
    async (id: string, occurrenceDate?: string) => {
      const task = await repository.toggle(id, occurrenceDate);
      bump();
      void syncTaskNotifications(task).catch(() => undefined);
      return task;
    },
    [bump, repository],
  );
  const skipTask = useCallback(
    async (id: string, occurrenceDate: string) => {
      const task = await repository.skip(id, occurrenceDate);
      bump();
      void syncTaskNotifications(task).catch(() => undefined);
      return task;
    },
    [bump, repository],
  );
  const startTimeTracking = useCallback(
    async (id: string, description?: string) => {
      const task = await repository.startTimeTracking(id, description);
      bump();
      return task;
    },
    [bump, repository],
  );
  const stopTimeTracking = useCallback(
    async (id: string) => {
      const task = await repository.stopTimeTracking(id);
      bump();
      return task;
    },
    [bump, repository],
  );
  const replaceTimeEntries = useCallback(
    async (id: string, entries: TaskTimeEntry[]) => {
      const task = await repository.replaceTimeEntries(id, entries);
      bump();
      return task;
    },
    [bump, repository],
  );
  const removeTimeEntry = useCallback(
    async (id: string, index: number) => {
      const task = await repository.removeTimeEntry(id, index);
      bump();
      return task;
    },
    [bump, repository],
  );
  const setTaskArchived = useCallback(
    async (id: string, archived: boolean) => {
      const task = await repository.setArchived(id, archived);
      bump();
      void syncTaskNotifications(task).catch(() => undefined);
      return task;
    },
    [bump, repository],
  );
  const deleteTask = useCallback(
    async (id: string) => {
      await repository.delete(id);
      bump();
      void removeTaskNotifications(id).catch(() => undefined);
    },
    [bump, repository],
  );
  const resolveSyncIssue = useCallback(
    async (id: string, resolution: "local" | "remote") => {
      await repository.resolveSyncIssue(id, resolution);
      bump();
      await loadSync();
    },
    [bump, loadSync, repository],
  );

  const value = useMemo<RepositoryContextValue>(
    () => ({
      repository,
      status,
      error,
      refreshing,
      lastRefresh,
      sync,
      syncIssues,
      version,
      configuration,
      createTask,
      updateTask,
      toggleTask,
      skipTask,
      startTimeTracking,
      stopTimeTracking,
      replaceTimeEntries,
      removeTimeEntry,
      setTaskArchived,
      deleteTask,
      refresh,
      resolveSyncIssue,
    }),
    [
      repository,
      status,
      error,
      refreshing,
      lastRefresh,
      sync,
      syncIssues,
      version,
      configuration,
      createTask,
      updateTask,
      toggleTask,
      skipTask,
      startTimeTracking,
      stopTimeTracking,
      replaceTimeEntries,
      removeTimeEntry,
      setTaskArchived,
      deleteTask,
      refresh,
      resolveSyncIssue,
    ],
  );

  return (
    <RepositoryContext.Provider value={value}>
      {children}
    </RepositoryContext.Provider>
  );
}

export function useRepository(): RepositoryContextValue {
  const value = useContext(RepositoryContext);
  if (!value) throw new Error("Task repository provider is missing.");
  return value;
}

export function useTasks(query: TaskListQuery): {
  tasks: Task[];
  loading: boolean;
  error: Error | null;
} {
  const { repository, status, version } = useRepository();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [resolved, setResolved] = useState("");
  const statusFilter = query.status;
  const search = query.search;
  const limit = query.limit;
  const archived = query.archived;
  const key = `${statusFilter ?? "open"}:${archived ?? "exclude"}:${search ?? ""}:${limit ?? 500}`;

  useEffect(() => {
    if (status !== "ready") return;
    let active = true;
    repository
      .list({ status: statusFilter, archived, search, limit })
      .then((result) => {
        if (!active) return;
        setTasks(result);
        setError(null);
        setResolved(key);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(asError(reason));
        setResolved(key);
      });
    return () => {
      active = false;
    };
  }, [archived, key, limit, repository, search, status, statusFilter, version]);

  return { tasks, loading: status === "opening" || resolved !== key, error };
}

export function useTask(id: string | null): {
  task: Task | null;
  loading: boolean;
  error: Error | null;
} {
  const { repository, status, version } = useRepository();
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (!id || status !== "ready") return;
    let active = true;
    repository
      .get(id)
      .then((result) => {
        if (!active) return;
        setTask(result);
        setError(null);
        setResolved(id);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(asError(reason));
        setResolved(id);
      });
    return () => {
      active = false;
    };
  }, [id, repository, status, version]);

  return {
    task,
    loading: status === "opening" || (Boolean(id) && resolved !== id),
    error,
  };
}

export function useCollectionSummary(): {
  info: CollectionInfo | null;
  stats: TaskStats | null;
  loading: boolean;
} {
  const { repository, status, version } = useRepository();
  const [info, setInfo] = useState<CollectionInfo | null>(null);
  const [stats, setStats] = useState<TaskStats | null>(null);
  useEffect(() => {
    if (status !== "ready") return;
    let active = true;
    Promise.all([repository.collectionInfo(), repository.stats()]).then(
      ([nextInfo, nextStats]) => {
        if (!active) return;
        setInfo(nextInfo);
        setStats(nextStats);
      },
    );
    return () => {
      active = false;
    };
  }, [repository, status, version]);
  return { info, stats, loading: status !== "ready" || !info || !stats };
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

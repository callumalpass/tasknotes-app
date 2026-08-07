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
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { TaskCommandService } from "../application/task-commands";
import {
  QueryInvalidationStore,
  type QueryScope,
} from "../application/query-invalidation";
import {
  createRepositoryAutoArchiveActivity,
  type AutoArchiveActivity,
} from "../application/auto-archive-activity";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import {
  reconcileTaskNotifications,
  removeTaskNotifications,
  syncTaskNotifications,
  taskUpdateAffectsNotifications,
  type ReminderAuthority,
} from "../native/notifications";

import type {
  CreateTaskInput,
  MaterializeOccurrenceResult,
  Task,
  TaskListQuery,
  TaskStats,
  TaskTimeEntry,
  UpdateTaskInput,
} from "../domain/task";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskModelSettingsPatch } from "../domain/task-configuration";
import type { TaskRelationships } from "../domain/task-relationships";
import type {
  CollectionInfo,
  RefreshResult,
  RepositoryConnectionStatus,
  TaskRepository,
} from "../application/ports/task-repository";
import type { MutationJournal } from "../application/mutation-journal";
import type { OperationalError } from "../application/operational-error";

type StorageStatus = "opening" | "ready" | "error";

interface RepositoryContextValue {
  repository: TaskRepository;
  status: StorageStatus;
  error: Error | null;
  refreshing: boolean;
  lastRefresh: RefreshResult | null;
  connection: RepositoryConnectionStatus;
  invalidation: QueryInvalidationStore;
  configuration: TaskCollectionConfiguration;
  pendingDeletion: { id: string; title: string } | null;
  deletionError: OperationalError | null;
  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(id: string, input: UpdateTaskInput): Promise<Task>;
  updateTasks(
    updates: readonly { id: string; input: UpdateTaskInput }[],
  ): Promise<Task[]>;
  toggleTask(id: string, occurrenceDate?: string): Promise<Task>;
  skipTask(id: string, occurrenceDate: string): Promise<Task>;
  materializeOccurrence(
    parentId: string,
    occurrenceDate: string,
  ): Promise<MaterializeOccurrenceResult>;
  startTimeTracking(id: string, description?: string): Promise<Task>;
  stopTimeTracking(id: string): Promise<Task>;
  replaceTimeEntries(id: string, entries: TaskTimeEntry[]): Promise<Task>;
  removeTimeEntry(id: string, index: number): Promise<Task>;
  setTaskArchived(id: string, archived: boolean): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  undoTaskDeletion(): Promise<void>;
  retryTaskDeletion(): Promise<void>;
  updateTaskModelSettings(
    patch: TaskModelSettingsPatch,
  ): Promise<TaskCollectionConfiguration>;
  refresh(): Promise<RefreshResult>;
}

const RepositoryContext = createContext<RepositoryContextValue | null>(null);

export function RepositoryProvider({
  children,
  repository: supplied,
  reminderAuthority = "none",
  mutationJournal: suppliedMutationJournal,
}: {
  children: ReactNode;
  repository: TaskRepository;
  reminderAuthority?: ReminderAuthority;
  mutationJournal: MutationJournal;
}) {
  const [repository] = useState<TaskRepository>(() => supplied);
  const [mutationJournal] = useState<MutationJournal>(
    () => suppliedMutationJournal,
  );
  const [status, setStatus] = useState<StorageStatus>("opening");
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<RefreshResult | null>(null);
  const [connection, setConnection] = useState<RepositoryConnectionStatus>({
    state: "connecting",
  });
  const [invalidation] = useState(() => new QueryInvalidationStore());
  const [pendingDeletion, setPendingDeletion] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [deletionError, setDeletionError] = useState<OperationalError | null>(
    null,
  );
  const [configuration, setConfiguration] =
    useState<TaskCollectionConfiguration>(defaultTaskCollectionConfiguration);
  const refreshInFlight = useRef<Promise<RefreshResult> | null>(null);
  const configurationRef = useRef(configuration);
  const autoArchiveRef = useRef<AutoArchiveActivity | null>(null);
  const taskCommandsRef = useRef<TaskCommandService | null>(null);
  const taskCommandsReadyRef =
    useRef<Promise<TaskCommandService | null> | null>(null);

  const bump = useCallback(() => invalidation.invalidateAll(), [invalidation]);
  const loadConnection = useCallback(async () => {
    const nextStatus = await repository.connectionStatus();
    setConnection(nextStatus);
  }, [repository]);
  const refresh = useCallback(() => {
    if (refreshInFlight.current) return refreshInFlight.current;
    setRefreshing(true);
    const run = repository
      .refresh()
      .then(async (result) => {
        const nextConfiguration = await repository.taskConfiguration();
        configurationRef.current = nextConfiguration;
        setConfiguration(nextConfiguration);
        await autoArchiveRef.current?.reconcile();
        setLastRefresh(result);
        setError(null);
        void loadConnection().catch(() => undefined);
        if (reminderAuthority === "connect")
          void reconcileTaskNotifications(repository, reminderAuthority).catch(
            () => undefined,
          );
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
  }, [loadConnection, reminderAuthority, repository]);

  useEffect(() => {
    repository.resume?.();
    let active = true;
    let unsubscribeCommands: (() => void) | undefined;
    let resolveTaskCommands: (service: TaskCommandService | null) => void;
    taskCommandsReadyRef.current = new Promise((resolve) => {
      resolveTaskCommands = resolve;
    });
    repository
      .initialize()
      .then(async () => {
        const nextConfiguration = await repository.taskConfiguration();
        if (!active) return;
        configurationRef.current = nextConfiguration;
        const autoArchive = await createRepositoryAutoArchiveActivity({
          repository,
          configuration: () => configurationRef.current,
          onArchived: (task) => {
            void syncTaskNotifications(
              repository,
              task,
              reminderAuthority,
            ).catch(() => undefined);
          },
        });
        if (!active) {
          autoArchive.dispose();
          return;
        }
        autoArchiveRef.current = autoArchive;
        await autoArchive.start();
        if (!active) return;
        const taskCommands = new TaskCommandService({
          repository,
          journal: mutationJournal,
          onDeleted: async (id) => {
            await autoArchive.forget(id);
            invalidation.invalidateTasks([id]);
            if (reminderAuthority === "connect")
              void removeTaskNotifications(
                repository,
                id,
                reminderAuthority,
              ).catch(() => undefined);
          },
          onTasksUpdated: async (tasks, updates) => {
            invalidation.invalidateTasks(updates.map(({ id }) => id));
            for (let index = 0; index < tasks.length; index += 1) {
              const input = updates[index]!.input;
              const task = tasks[index]!;
              if (taskUpdateAffectsAutoArchive(input))
                await autoArchive.observe(task);
              if (
                reminderAuthority === "connect" &&
                taskUpdateAffectsNotifications(input)
              )
                void syncTaskNotifications(
                  repository,
                  task,
                  reminderAuthority,
                ).catch(() => undefined);
            }
          },
        });
        taskCommandsRef.current = taskCommands;
        const publishCommandSnapshot = () => {
          const snapshot = taskCommands.snapshot();
          setPendingDeletion(
            snapshot.pendingDeletion
              ? {
                  id: snapshot.pendingDeletion.taskId,
                  title: snapshot.pendingDeletion.title,
                }
              : null,
          );
          setDeletionError(snapshot.deletionError);
        };
        unsubscribeCommands = taskCommands.subscribe(publishCommandSnapshot);
        await taskCommands.initialize();
        publishCommandSnapshot();
        if (!active) {
          unsubscribeCommands();
          taskCommands.dispose();
          resolveTaskCommands!(null);
          return;
        }
        resolveTaskCommands!(taskCommands);
        setConfiguration(nextConfiguration);
        setStatus("ready");
        void loadConnection().catch(() => undefined);
        void reconcileTaskNotifications(repository, reminderAuthority).catch(
          () => undefined,
        );
        void refresh().catch(() => undefined);
      })
      .catch((reason: unknown) => {
        resolveTaskCommands!(null);
        if (!active) return;
        setError(asError(reason));
        setStatus("error");
      });
    return () => {
      active = false;
      repository.dispose?.();
      unsubscribeCommands?.();
      taskCommandsRef.current?.dispose();
      taskCommandsRef.current = null;
      taskCommandsReadyRef.current = null;
      resolveTaskCommands!(null);
      autoArchiveRef.current?.dispose();
      autoArchiveRef.current = null;
    };
  }, [
    bump,
    invalidation,
    loadConnection,
    mutationJournal,
    refresh,
    reminderAuthority,
    repository,
  ]);

  useEffect(() => {
    if (!repository.subscribe) return;
    return repository.subscribe(() => {
      bump();
      void loadConnection().catch(() => undefined);
      void autoArchiveRef.current?.reconcile().catch(() => undefined);
    });
  }, [bump, loadConnection, repository]);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      const handle = CapacitorApp.addListener(
        "appStateChange",
        ({ isActive }) => {
          if (!isActive) {
            repository.suspend?.();
            return;
          }
          repository.resume?.();
          if (status === "ready") void refresh().catch(() => undefined);
        },
      );
      return () => void handle.then((listener) => listener.remove());
    }
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        repository.suspend?.();
        return;
      }
      repository.resume?.();
      if (status === "ready") void refresh().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh, repository, status]);

  useEffect(() => {
    if (status !== "ready" || Capacitor.isNativePlatform()) return;
    const refreshIfAvailable = () => {
      if (document.visibilityState === "visible" && navigator.onLine !== false)
        void refresh().catch(() => undefined);
    };
    window.addEventListener("online", refreshIfAvailable);
    const timer = window.setInterval(refreshIfAvailable, 60_000);
    return () => {
      window.removeEventListener("online", refreshIfAvailable);
      window.clearInterval(timer);
    };
  }, [refresh, status]);

  const createTask = useCallback(
    async (input: CreateTaskInput) => {
      const task = await repository.create(input);
      await autoArchiveRef.current?.observe(task);
      if (reminderAuthority === "connect")
        void syncTaskNotifications(repository, task, reminderAuthority).catch(
          () => undefined,
        );
      return task;
    },
    [reminderAuthority, repository],
  );
  const updateTask = useCallback(
    async (id: string, input: UpdateTaskInput) => {
      const task = await repository.update(id, input);
      invalidation.invalidateTasks([id]);
      if (taskUpdateAffectsAutoArchive(input))
        await autoArchiveRef.current?.observe(task);
      if (
        reminderAuthority === "connect" &&
        taskUpdateAffectsNotifications(input)
      )
        void syncTaskNotifications(repository, task, reminderAuthority).catch(
          () => undefined,
        );
      return task;
    },
    [invalidation, reminderAuthority, repository],
  );
  const updateTasks = useCallback(
    async (updates: readonly { id: string; input: UpdateTaskInput }[]) => {
      const commands = await taskCommandsReadyRef.current;
      if (!commands) throw new Error("Task commands are not ready.");
      return commands.updateTasks(updates);
    },
    [],
  );
  const toggleTask = useCallback(
    async (id: string, occurrenceDate?: string) => {
      const task = await repository.toggle(id, occurrenceDate);
      await autoArchiveRef.current?.observe(task);
      if (reminderAuthority === "connect")
        void syncTaskNotifications(repository, task, reminderAuthority).catch(
          () => undefined,
        );
      return task;
    },
    [reminderAuthority, repository],
  );
  const skipTask = useCallback(
    async (id: string, occurrenceDate: string) => {
      const task = await repository.skip(id, occurrenceDate);
      await autoArchiveRef.current?.observe(task);
      if (reminderAuthority === "connect")
        void syncTaskNotifications(repository, task, reminderAuthority).catch(
          () => undefined,
        );
      return task;
    },
    [reminderAuthority, repository],
  );
  const materializeOccurrence = useCallback(
    async (parentId: string, occurrenceDate: string) => {
      const result = await repository.materializeOccurrence(
        parentId,
        occurrenceDate,
      );
      await autoArchiveRef.current?.observe(result.task);
      if (reminderAuthority === "connect")
        void syncTaskNotifications(
          repository,
          result.task,
          reminderAuthority,
        ).catch(() => undefined);
      return result;
    },
    [reminderAuthority, repository],
  );
  const startTimeTracking = useCallback(
    async (id: string, description?: string) => {
      const task = await repository.startTimeTracking(id, description);
      await autoArchiveRef.current?.observe(task);
      return task;
    },
    [repository],
  );
  const stopTimeTracking = useCallback(
    async (id: string) => {
      const task = await repository.stopTimeTracking(id);
      await autoArchiveRef.current?.observe(task);
      return task;
    },
    [repository],
  );
  const replaceTimeEntries = useCallback(
    async (id: string, entries: TaskTimeEntry[]) => {
      const task = await repository.replaceTimeEntries(id, entries);
      await autoArchiveRef.current?.observe(task);
      return task;
    },
    [repository],
  );
  const removeTimeEntry = useCallback(
    async (id: string, index: number) => {
      const task = await repository.removeTimeEntry(id, index);
      await autoArchiveRef.current?.observe(task);
      return task;
    },
    [repository],
  );
  const setTaskArchived = useCallback(
    async (id: string, archived: boolean) => {
      const task = await repository.setArchived(id, archived);
      await autoArchiveRef.current?.observe(task);
      if (reminderAuthority === "connect")
        void syncTaskNotifications(repository, task, reminderAuthority).catch(
          () => undefined,
        );
      return task;
    },
    [reminderAuthority, repository],
  );
  const deleteTask = useCallback(async (id: string) => {
    const commands = await taskCommandsReadyRef.current;
    if (!commands) throw new Error("Task commands are not ready.");
    await commands.requestDeletion(id);
  }, []);
  const undoTaskDeletion = useCallback(async () => {
    await taskCommandsRef.current?.undoDeletion();
  }, []);
  const retryTaskDeletion = useCallback(async () => {
    await taskCommandsRef.current?.retryDeletion();
  }, []);
  const updateTaskModelSettings = useCallback(
    async (patch: TaskModelSettingsPatch) => {
      const next = await repository.updateTaskModelSettings(patch);
      configurationRef.current = next;
      setConfiguration(next);
      await autoArchiveRef.current?.reconcile();
      return next;
    },
    [repository],
  );

  const value = useMemo<RepositoryContextValue>(
    () => ({
      repository,
      status,
      error,
      refreshing,
      lastRefresh,
      connection,
      invalidation,
      configuration,
      pendingDeletion,
      deletionError,
      createTask,
      updateTask,
      updateTasks,
      toggleTask,
      skipTask,
      materializeOccurrence,
      startTimeTracking,
      stopTimeTracking,
      replaceTimeEntries,
      removeTimeEntry,
      setTaskArchived,
      deleteTask,
      undoTaskDeletion,
      retryTaskDeletion,
      updateTaskModelSettings,
      refresh,
    }),
    [
      repository,
      status,
      error,
      refreshing,
      lastRefresh,
      connection,
      invalidation,
      configuration,
      pendingDeletion,
      deletionError,
      createTask,
      updateTask,
      updateTasks,
      toggleTask,
      skipTask,
      materializeOccurrence,
      startTimeTracking,
      stopTimeTracking,
      replaceTimeEntries,
      removeTimeEntry,
      setTaskArchived,
      deleteTask,
      undoTaskDeletion,
      retryTaskDeletion,
      updateTaskModelSettings,
      refresh,
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
  const { pendingDeletion, repository, status } = useRepository();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [resolved, setResolved] = useState("");
  const statusFilter = query.status;
  const search = query.search;
  const limit = query.limit;
  const archived = query.archived;
  const key = `${statusFilter ?? "open"}:${archived ?? "exclude"}:${search ?? ""}:${limit ?? 500}`;
  const revision = useRepositoryRevision(`tasks:${key}`);

  useEffect(() => {
    if (status !== "ready") return;
    let active = true;
    repository
      .list({ status: statusFilter, archived, search, limit })
      .then((result) => {
        if (!active) return;
        setTasks(
          pendingDeletion
            ? result.filter((task) => task.id !== pendingDeletion.id)
            : result,
        );
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
  }, [
    archived,
    key,
    limit,
    pendingDeletion,
    repository,
    search,
    status,
    statusFilter,
    revision,
  ]);

  return { tasks, loading: status === "opening" || resolved !== key, error };
}

export function useTask(id: string | null): {
  task: Task | null;
  loading: boolean;
  error: Error | null;
} {
  const { pendingDeletion, repository, status } = useRepository();
  const revision = useRepositoryRevision(`task:${id ?? "none"}`);
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
        setTask(pendingDeletion?.id === id ? null : result);
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
  }, [id, pendingDeletion, repository, revision, status]);

  return {
    task,
    loading: status === "opening" || (Boolean(id) && resolved !== id),
    error,
  };
}

export function useTaskRelationships(id: string): {
  relationships: TaskRelationships;
  loading: boolean;
  error: Error | null;
} {
  const { repository, status } = useRepository();
  const revision = useRepositoryRevision(`relationships:${id}`);
  const [relationships, setRelationships] = useState<TaskRelationships>(
    emptyTaskRelationships,
  );
  const [error, setError] = useState<Error | null>(null);
  const [resolved, setResolved] = useState("");

  useEffect(() => {
    if (status !== "ready") return;
    let active = true;
    repository
      .relationships(id)
      .then((result) => {
        if (!active) return;
        setRelationships(result);
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
  }, [id, repository, revision, status]);

  return {
    relationships,
    loading: status === "opening" || resolved !== id,
    error,
  };
}

export function useCollectionSummary(): {
  info: CollectionInfo | null;
  stats: TaskStats | null;
  loading: boolean;
} {
  const { repository, status } = useRepository();
  const revision = useRepositoryRevision("collection-summary");
  const [info, setInfo] = useState<CollectionInfo | null>(null);
  const [stats, setStats] = useState<TaskStats | null>(null);
  useEffect(() => {
    if (status !== "ready") return;
    let active = true;
    void Promise.all([repository.collectionInfo(), repository.stats()])
      .then(([nextInfo, nextStats]) => {
        if (!active) return;
        setInfo(nextInfo);
        setStats(nextStats);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [repository, revision, status]);
  return { info, stats, loading: status !== "ready" || !info || !stats };
}

export function useRepositoryRevision(scope: QueryScope): number {
  const { invalidation } = useRepository();
  return useSyncExternalStore(
    (listener) => invalidation.subscribe(scope, listener),
    () => invalidation.revision(scope),
    () => invalidation.revision(scope),
  );
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function taskUpdateAffectsAutoArchive(input: UpdateTaskInput): boolean {
  return ["archived", "completed", "status"].some((property) =>
    Object.hasOwn(input, property),
  );
}

function emptyTaskRelationships(): TaskRelationships {
  return {
    blockedBy: [],
    blocking: [],
    subtasks: [],
    projectTasks: [],
  };
}

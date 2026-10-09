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

import {
  TaskMutations,
  completionKey,
  type CompletionCommand,
} from "../application/task-mutations";
import { QueryResource } from "../application/query-resource";
import { TaskCommandService } from "../application/task-commands";
import {
  AcceptedTaskEffects,
  acceptedWriteEffect,
} from "../application/accepted-task-effects";
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
  TaskSummary,
  TaskSearchResult,
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
  TaskCreateIntent,
} from "../application/ports/task-repository";
import type { MutationJournal } from "../application/mutation-journal";
import type { OperationalError } from "../application/operational-error";
import type { PrivateAccountUi } from "../components/private-account-settings";

type StorageStatus = "opening" | "ready" | "error";

interface RepositoryContextValue {
  repository: TaskRepository;
  /** Authenticated SDK account facade, injected only by a qualified private host. */
  privateAccount?: PrivateAccountUi;
  status: StorageStatus;
  error: Error | null;
  refreshing: boolean;
  lastRefresh: RefreshResult | null;
  connection: RepositoryConnectionStatus;
  invalidation: QueryInvalidationStore;
  mutations: TaskMutations;
  setTaskCompletion(command: CompletionCommand): Promise<Task>;
  configuration: TaskCollectionConfiguration;
  /** Whether this collection delivers reminder notifications at all. */
  reminderAuthority: ReminderAuthority;
  pendingDeletion: {
    id: string;
    title: string;
    outcomeUnknown: boolean;
  } | null;
  deletionError: OperationalError | null;
  createTask(input: CreateTaskInput, intent?: TaskCreateIntent): Promise<Task>;
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

// UI mount references only, never READ readiness or authority. Effect replay
// and synchronous remount can retain the same original held repository.
const repositoryMounts = new WeakMap<TaskRepository, Set<object>>();
function retainRepositoryMount(repository: TaskRepository) {
  let mounts = repositoryMounts.get(repository);
  if (!mounts) {
    mounts = new Set();
    repositoryMounts.set(repository, mounts);
  }
  const activeMounts = mounts;
  const mount = {};
  activeMounts.add(mount);
  return () => {
    activeMounts.delete(mount);
    if (activeMounts.size) return;
    if (repository.suspend && repository.resume) {
      // Cancel immediately; close permanently only if no mount retains it
      // before the microtask. No new client or authority is constructed.
      repository.suspend();
      queueMicrotask(() => {
        if (
          activeMounts.size ||
          repositoryMounts.get(repository) !== activeMounts
        )
          return;
        repositoryMounts.delete(repository);
        repository.dispose?.();
      });
    } else {
      repositoryMounts.delete(repository);
      repository.dispose?.();
    }
  };
}

export function RepositoryProvider({
  children,
  repository: supplied,
  reminderAuthority = "none",
  mutationJournal: suppliedMutationJournal,
  discardPendingRecovery,
  privateAccount,
}: {
  children: ReactNode;
  repository: TaskRepository;
  reminderAuthority?: ReminderAuthority;
  mutationJournal: MutationJournal;
  discardPendingRecovery?(): Promise<void>;
  privateAccount?: PrivateAccountUi;
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
  const [mutations] = useState(() => new TaskMutations());
  const [pendingDeletion, setPendingDeletion] = useState<{
    id: string;
    title: string;
    outcomeUnknown: boolean;
  } | null>(null);
  const [deletionError, setDeletionError] = useState<OperationalError | null>(
    null,
  );
  const [configuration, setConfiguration] =
    useState<TaskCollectionConfiguration>(defaultTaskCollectionConfiguration);
  const refreshInFlight = useRef<Promise<RefreshResult> | null>(null);
  const startupRef = useRef<(() => Promise<void>) | null>(null);
  const interruptStartupRef = useRef<(() => void) | null>(null);
  const readyRef = useRef(false);
  const lifecycleRef = useRef(0);
  const configurationRef = useRef(configuration);
  const autoArchiveRef = useRef<AutoArchiveActivity | null>(null);
  const taskCommandsRef = useRef<TaskCommandService | null>(null);
  const taskCommandsReadyRef =
    useRef<Promise<TaskCommandService | null> | null>(null);

  const acceptedEffectsRef = useRef<AcceptedTaskEffects | null>(null);
  const acceptTask = useCallback(
    (task: Task, options?: Parameters<AcceptedTaskEffects["task"]>[1]) =>
      acceptedEffectsRef.current?.task(task, options) ?? Promise.resolve(task),
    [],
  );

  const bump = useCallback(() => invalidation.invalidateAll(), [invalidation]);
  const loadConnection = useCallback(async () => {
    const lifecycle = lifecycleRef.current;
    const nextStatus = await repository.connectionStatus();
    if (lifecycle === lifecycleRef.current) setConnection(nextStatus);
  }, [repository]);
  const refresh = useCallback(() => {
    if (refreshInFlight.current) return refreshInFlight.current;
    setRefreshing(true);
    const lifecycle = lifecycleRef.current;
    const run = Promise.resolve()
      .then(async () => {
        if (!readyRef.current) await startupRef.current?.();
        if (lifecycle !== lifecycleRef.current)
          throw new DOMException(
            "The foreground refresh was interrupted.",
            "AbortError",
          );
        return repository.refresh();
      })
      .then(async (result) => {
        const nextConfiguration = await repository.taskConfiguration();
        if (lifecycle !== lifecycleRef.current) return result;
        configurationRef.current = nextConfiguration;
        setConfiguration(nextConfiguration);
        await autoArchiveRef.current?.reconcile();
        if (lifecycle !== lifecycleRef.current) return result;
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
        if (lifecycle === lifecycleRef.current) setError(next);
        throw next;
      })
      .finally(() => {
        if (refreshInFlight.current === run) {
          refreshInFlight.current = null;
          setRefreshing(false);
        }
      });
    refreshInFlight.current = run;
    return run;
  }, [loadConnection, reminderAuthority, repository]);

  useEffect(() => {
    repository.resume?.();
    const releaseMount = retainRepositoryMount(repository);
    let active = true;
    let generation = 0;
    let opening: Promise<void> | null = null;
    let disposeStartup: (() => void) | undefined;
    const start = () => {
      if (opening) return opening;
      disposeStartup?.();
      const attempt = ++generation;
      const current = () => active && attempt === generation;
      readyRef.current = false;
      setStatus("opening");
      setError(null);
      let unsubscribeCommands: (() => void) | undefined;
      let autoArchive: AutoArchiveActivity | undefined;
      let acceptedEffects: AcceptedTaskEffects | undefined;
      let taskCommands: TaskCommandService | undefined;
      let resolveTaskCommands!: (service: TaskCommandService | null) => void;
      taskCommandsReadyRef.current = new Promise((resolve) => {
        resolveTaskCommands = resolve;
      });
      const disposeAttempt = () => {
        unsubscribeCommands?.();
        taskCommands?.dispose();
        autoArchive?.dispose();
        if (acceptedEffectsRef.current === acceptedEffects)
          acceptedEffectsRef.current = null;
        resolveTaskCommands(null);
      };
      disposeStartup = disposeAttempt;
      const run = repository
        .initialize({ deferTaskIndex: true })
        .then(async () => {
          const nextConfiguration = await repository.taskConfiguration();
          if (!current()) return;
          configurationRef.current = nextConfiguration;
          autoArchive = await createRepositoryAutoArchiveActivity({
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
          if (!current()) {
            disposeAttempt();
            return;
          }
          autoArchiveRef.current = autoArchive;
          const archive = autoArchive;
          const effects = new AcceptedTaskEffects({
            invalidate: (ids) => invalidation.invalidateTasks(ids),
            observe: (task) => archive.observe(task),
            forget: (id) => archive.forget(id),
            notify: (task) =>
              syncTaskNotifications(repository, task, reminderAuthority),
            removeNotifications: (id) =>
              removeTaskNotifications(repository, id, reminderAuthority),
            affectsNotifications: taskUpdateAffectsNotifications,
          });
          acceptedEffects = effects;
          acceptedEffectsRef.current = effects;
          // Reconciliation has its own error reporting and must not gate the view.
          void autoArchive.start().catch(() => undefined);
          if (!current()) return;
          taskCommands = new TaskCommandService({
            repository,
            journal: mutationJournal,
            ...(discardPendingRecovery
              ? {
                  discardPendingRequest: async () => discardPendingRecovery(),
                }
              : {}),
            onDeleted: (id) => effects.deleted(id),
            onTasksUpdated: (tasks, updates) => effects.updated(tasks, updates),
          });
          const commands = taskCommands;
          const publishCommandSnapshot = () => {
            if (!current()) return;
            const snapshot = commands.snapshot();
            setPendingDeletion(
              snapshot.pendingDeletion
                ? {
                    id: snapshot.pendingDeletion.taskId,
                    title: snapshot.pendingDeletion.title,
                    outcomeUnknown: Boolean(
                      snapshot.pendingDeletion.authorityRequestId,
                    ),
                  }
                : null,
            );
            setDeletionError(snapshot.deletionError);
          };
          unsubscribeCommands = taskCommands.subscribe(publishCommandSnapshot);
          await taskCommands.initialize();
          publishCommandSnapshot();
          if (!current()) {
            disposeAttempt();
            return;
          }
          taskCommandsRef.current = taskCommands;
          resolveTaskCommands(taskCommands);
          setConfiguration(nextConfiguration);
          readyRef.current = true;
          setStatus("ready");
          void loadConnection().catch(() => undefined);
          void reconcileTaskNotifications(repository, reminderAuthority).catch(
            () => undefined,
          );
        })
        .catch((reason: unknown) => {
          disposeAttempt();
          if (!current()) return;
          setError(asError(reason));
          setStatus("error");
          throw reason;
        })
        .finally(() => {
          if (opening === run) opening = null;
        });
      opening = run;
      return run;
    };
    startupRef.current = start;
    interruptStartupRef.current = () => {
      if (readyRef.current) return;
      generation += 1;
      opening = null;
      disposeStartup?.();
    };
    void start()
      .then(() => {
        if (active && readyRef.current) void refresh().catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      readyRef.current = false;
      lifecycleRef.current += 1;
      refreshInFlight.current = null;
      startupRef.current = null;
      interruptStartupRef.current = null;
      releaseMount();
      disposeStartup?.();
      taskCommandsRef.current = null;
      taskCommandsReadyRef.current = null;
      autoArchiveRef.current = null;
      acceptedEffectsRef.current = null;
    };
  }, [
    bump,
    invalidation,
    loadConnection,
    mutationJournal,
    discardPendingRecovery,
    refresh,
    reminderAuthority,
    repository,
  ]);

  useEffect(() => {
    if (!repository.subscribe) return;
    return repository.subscribe((change) => {
      void loadConnection().catch(() => undefined);
      if (change?.kind === "status") return;
      if (change?.kind === "lifecycle") {
        invalidation.invalidateViews();
        return;
      }
      bump();
      void autoArchiveRef.current?.reconcile().catch(() => undefined);
    });
  }, [bump, invalidation, loadConnection, repository]);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      const handle = CapacitorApp.addListener(
        "appStateChange",
        ({ isActive }) => {
          if (!isActive) {
            lifecycleRef.current += 1;
            repository.suspend?.();
            interruptStartupRef.current?.();
            refreshInFlight.current = null;
            return;
          }
          repository.resume?.();
          void refresh().catch(() => undefined);
        },
      );
      return () => void handle.then((listener) => listener.remove());
    }
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        lifecycleRef.current += 1;
        repository.suspend?.();
        interruptStartupRef.current?.();
        refreshInFlight.current = null;
        return;
      }
      repository.resume?.();
      void refresh().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh, repository]);

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
    async (input: CreateTaskInput, intent?: TaskCreateIntent) =>
      acceptTask(await repository.create(input, intent)),
    [acceptTask, repository],
  );
  const updateTask = useCallback(
    async (id: string, input: UpdateTaskInput) =>
      acceptTask(await repository.update(id, input), { input }),
    [acceptTask, repository],
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
    (id: string, occurrenceDate?: string, completed?: boolean) =>
      mutations.run(
        completionKey(id, occurrenceDate),
        async () => {
          const saved =
            completed === undefined
              ? await repository.toggle(id, occurrenceDate)
              : await repository.toggle(id, occurrenceDate, completed);
          return acceptTask(saved);
        },
        completed === undefined ? "toggle" : String(completed),
      ),
    [mutations, acceptTask, repository],
  );
  const setTaskCompletion = useCallback(
    (command: CompletionCommand) =>
      toggleTask(command.id, command.occurrenceDate, command.completed),
    [toggleTask],
  );
  const skipTask = useCallback(
    async (id: string, occurrenceDate: string) =>
      acceptTask(await repository.skip(id, occurrenceDate)),
    [acceptTask, repository],
  );
  const materializeOccurrence = useCallback(
    async (parentId: string, occurrenceDate: string) => {
      const result = await repository.materializeOccurrence(
        parentId,
        occurrenceDate,
      );
      return { ...result, task: await acceptTask(result.task) };
    },
    [acceptTask, repository],
  );
  const startTimeTracking = useCallback(
    async (id: string, description?: string) => {
      return acceptTask(await repository.startTimeTracking(id, description), {
        notify: false,
      });
    },
    [acceptTask, repository],
  );
  const stopTimeTracking = useCallback(
    async (id: string) => {
      return acceptTask(await repository.stopTimeTracking(id), {
        notify: false,
      });
    },
    [acceptTask, repository],
  );
  const replaceTimeEntries = useCallback(
    async (id: string, entries: TaskTimeEntry[]) => {
      return acceptTask(await repository.replaceTimeEntries(id, entries), {
        notify: false,
      });
    },
    [acceptTask, repository],
  );
  const removeTimeEntry = useCallback(
    async (id: string, index: number) => {
      return acceptTask(await repository.removeTimeEntry(id, index), {
        notify: false,
      });
    },
    [acceptTask, repository],
  );
  const setTaskArchived = useCallback(
    async (id: string, archived: boolean) => {
      return acceptTask(await repository.setArchived(id, archived));
    },
    [acceptTask, repository],
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
      await acceptedWriteEffect(
        "automatic archiving could not be reconciled",
        () => autoArchiveRef.current?.reconcile(),
      );
      return next;
    },
    [repository],
  );

  const value = useMemo<RepositoryContextValue>(
    () => ({
      repository,
      privateAccount,
      mutations,
      setTaskCompletion,
      status,
      error,
      refreshing,
      lastRefresh,
      connection,
      invalidation,
      configuration,
      reminderAuthority,
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
      privateAccount,
      mutations,
      setTaskCompletion,
      status,
      error,
      refreshing,
      lastRefresh,
      connection,
      invalidation,
      configuration,
      reminderAuthority,
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

interface TaskQueryState<Value> {
  tasks: Value[];
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  error: Error | null;
  retry(): void;
}

const summaryQuery = {
  kind: "summaries",
  load: (repository: TaskRepository, query: TaskListQuery) =>
    repository.listSummaries(query),
  id: (task: TaskSummary) => task.id,
};
const searchQuery = {
  kind: "search",
  load: (
    repository: TaskRepository,
    query: TaskListQuery,
    signal: AbortSignal,
  ) => repository.search(query, { signal }),
  id: (result: TaskSearchResult) => result.task.id,
};

export function useTasks(
  query: Omit<TaskListQuery, "search">,
): TaskQueryState<TaskSummary> {
  return useRepositoryTaskQuery(query, summaryQuery);
}

export function useTaskSearch(
  query: TaskListQuery,
): TaskQueryState<TaskSearchResult> {
  return useRepositoryTaskQuery(query, searchQuery);
}

function useRepositoryTaskQuery<Value>(
  query: TaskListQuery,
  reader: {
    kind: string;
    load(
      repository: TaskRepository,
      query: TaskListQuery,
      signal: AbortSignal,
    ): Promise<Value[]>;
    id(value: Value): string;
  },
): TaskQueryState<Value> {
  const {
    pendingDeletion,
    repository,
    status,
    error: openingError,
  } = useRepository();
  const [resource] = useState(() => new QueryResource<Value[]>());
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  const { status: statusFilter, search, limit, archived, assignedTo } = query;
  // Changing a prefix limit refreshes the same query; changing its meaning clears old results.
  const key = JSON.stringify([
    reader.kind,
    statusFilter ?? "open",
    archived ?? "exclude",
    search ?? "",
    assignedTo ?? null,
  ]);
  const revision = useRepositoryRevision(`tasks:${key}`);
  useEffect(() => {
    if (status !== "ready") return;
    resource.load(key, (signal) =>
      reader.load(
        repository,
        {
          status: statusFilter,
          archived,
          search,
          limit,
          ...(assignedTo !== undefined ? { assignedTo } : {}),
        },
        signal,
      ),
    );
    return resource.cancel;
  }, [
    archived,
    assignedTo,
    key,
    limit,
    repository,
    resource,
    search,
    status,
    statusFilter,
    revision,
    reader,
  ]);
  const tasks = state.key === key ? (state.data ?? []) : [];
  return {
    tasks: pendingDeletion
      ? tasks.filter((task) => reader.id(task) !== pendingDeletion.id)
      : tasks,
    loading:
      status === "opening" || state.key !== key || state.status === "loading",
    refreshing: state.status === "refreshing",
    stale: state.key === key && state.stale,
    error: openingError ?? (state.key === key ? state.error : null),
    retry: resource.retry,
  };
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

function emptyTaskRelationships(): TaskRelationships {
  return {
    blockedBy: [],
    blocking: [],
    subtasks: [],
    projectTasks: [],
  };
}

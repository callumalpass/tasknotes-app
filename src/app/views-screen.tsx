import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns3,
  GripVertical,
  FolderKanban,
  List,
  Pencil,
  Pin,
  Plus,
  Search,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import { LoadingRows } from "../components/loading";
import { TaskCapture } from "../components/task-capture";
import { TaskRow } from "../components/task-row";
import { calendarEvents } from "../domain/calendar-events";
import {
  kanbanMoveInput,
  kanbanPropertyRole,
  type KanbanFieldMapping,
} from "../domain/kanban";
import { dateFromStorage, todayString } from "../domain/task";
import {
  appendManualOrderRank,
  manualOrderConfiguration,
  planManualOrder,
  sortTasksByManualOrder,
  type ManualOrderConfiguration,
  type ManualOrderPlacement,
} from "../domain/manual-order";
import {
  createPlanForView,
  mergeTaskCreationDefaults,
  propertiesToCreateDefaults,
  type ViewCreationPlan,
} from "../domain/view-creation";
import { groupTaskViewRows } from "../domain/view-grouping";
import { sectionTaskViewRows } from "../domain/task-list-sections";
import {
  formatPropertyValue,
  propertyLabel,
  viewPropertyDetails,
} from "../domain/view-values";
import { selectionFeedback } from "../native/feedback";
import {
  linkTarget,
  recordCompletion,
  type CollectionRecord,
} from "../domain/completion";
import { useRepository, useTasks } from "./repository-context";
import { ViewEditor } from "./view-editor";
import { preloadViewEditor } from "./view-editor-loader";
import { localIndexingLabel } from "./indexing-progress";
import { readViewDraft } from "../domain/view-document";

import type { CreateTaskInput, Task, UpdateTaskInput } from "../domain/task";
import type { TaskOccurrence } from "../domain/task-occurrence";
import type {
  TaskView,
  TaskViewDocument,
  TaskViewExecution,
  TaskViewProperty,
  TaskViewRow,
} from "../domain/view";

const FullCalendarView = lazy(async () => ({
  default: (await import("./full-calendar-view")).FullCalendarView,
}));

export function ViewsScreen({
  viewKey,
  documents,
  views,
  error: viewsError,
  navigationViewKeys,
  operational = false,
  onBack,
  onOpenTask,
  onSearch,
  onOpenView,
  onToggleNavigationView,
  onMoveNavigationView,
  onViewsChanged,
}: {
  viewKey?: string;
  documents: TaskViewDocument[] | null;
  views: TaskView[] | null;
  error?: string;
  navigationViewKeys: string[];
  operational?: boolean;
  onBack(): void;
  onOpenTask(task: Task, occurrenceDate?: string): void;
  onSearch(): void;
  onOpenView(view: TaskView): void;
  onToggleNavigationView(key: string): void;
  onMoveNavigationView(key: string, direction: -1 | 1): void;
  onViewsChanged(): Promise<void>;
}) {
  const {
    repository,
    createTask,
    toggleTask,
    updateTask,
    updateTasks,
    configuration,
    indexing,
    version,
  } = useRepository();
  const [execution, setExecution] = useState<TaskViewExecution | null>(null);
  const [executionError, setExecutionError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [refreshingExecution, setRefreshingExecution] = useState<string | null>(
    null,
  );
  const [editing, setEditing] = useState<TaskView | "new" | null>(null);
  const [boardMoves, setBoardMoves] = useState<
    Map<
      string,
      {
        viewKey: string;
        property: string;
        value: unknown;
        sequence: number;
      }
    >
  >(() => new Map());
  const [viewActionError, setViewActionError] = useState<{
    viewKey: string;
    message: string;
  } | null>(null);
  const [creationPlan, setCreationPlan] = useState<{
    key: string;
    revision: string;
    plan: ViewCreationPlan;
  } | null>(null);
  const [creationContext, setCreationContext] = useState<{
    key: string;
    label: string;
    defaults: Partial<CreateTaskInput>;
    focusRequest: number;
  } | null>(null);
  const [calendarSelection, setCalendarSelection] = useState<{
    key: string;
    date: string;
    createValue: string;
  } | null>(null);
  const [sourceSort, setSourceSort] = useState<{
    key: string;
    sort: NonNullable<TaskView["sort"]>;
  } | null>(null);
  const [manualRanks, setManualRanks] = useState<
    Map<string, { viewKey: string; sortOrder: string; operationId: number }>
  >(() => new Map());
  const [manualOrderPending, setManualOrderPending] = useState<
    Map<number, { viewKey: string; taskId: string }>
  >(() => new Map());
  const [reorderingView, setReorderingView] = useState<string | null>(null);
  const boardMutationSequence = useRef(new Map<string, number>());
  const boardMutationQueues = useRef(new Map<string, Promise<void>>());
  const manualOrderMutationSequence = useRef(0);
  const manualOrderMutationQueue = useRef<Promise<void>>(Promise.resolve());
  const completeField = useCallback(
    (request: import("../domain/completion").FieldCompletionRequest) =>
      repository.completeField(request),
    [repository],
  );
  const hasWritableViews = views?.some((view) => view.source.writable) ?? false;
  useEffect(() => {
    if (!hasWritableViews) return;
    const timeout = window.setTimeout(preloadViewEditor, 400);
    return () => window.clearTimeout(timeout);
  }, [hasWritableViews]);

  const selected = views?.find((view) => view.key === viewKey);
  const needsIdentityTasks =
    selected?.presentation?.type === "tasknotes.calendar" ||
    selected?.presentation?.type === "tasknotes.mini-calendar";
  const { tasks: identityTasks } = useTasks({
    status: "all",
    limit: needsIdentityTasks ? 50_000 : 0,
  });
  const selectedKey = selected?.key;
  const selectedKeyRef = useRef(selectedKey);
  useEffect(() => {
    selectedKeyRef.current = selectedKey;
  }, [selectedKey]);
  useEffect(() => {
    if (!viewKey || !selected) return;
    let active = true;
    let refreshed = false;
    const executionKey = `${selected.key}:${selected.source.revision}`;
    queueMicrotask(() => {
      if (active) setRefreshingExecution(executionKey);
    });
    void repository
      .cachedViewExecution(selected)
      .then((cached) => {
        if (!active || refreshed || !cached) return;
        setExecution({ ...cached, stale: true });
      })
      .catch(() => undefined);
    void repository.executeView(selected).then(
      (result) => {
        if (!active) return;
        refreshed = true;
        setExecution(result);
        setExecutionError(null);
        setRefreshingExecution(null);
      },
      (reason) => {
        if (!active) return;
        refreshed = true;
        setExecutionError({ key: selected.key, message: message(reason) });
        setRefreshingExecution(null);
      },
    );
    return () => {
      active = false;
    };
  }, [repository, selected, version, viewKey]);
  useEffect(() => {
    if (!viewKey || !selected) return;
    let active = true;
    void repository
      .readViewSource(selected.source.path)
      .then((source) => {
        if (!active) return;
        setSourceSort({
          key: selected.key,
          sort: readViewDraft(source, selected.id).sort,
        });
        setCreationPlan({
          key: selected.key,
          revision: selected.source.revision,
          plan: createPlanForView(selected, source, configuration),
        });
      })
      .catch(() => {
        if (!active) return;
        setSourceSort({ key: selected.key, sort: selected.sort ?? [] });
        setCreationPlan({
          key: selected.key,
          revision: selected.source.revision,
          plan: {
            defaults: {},
            inferredProperties: [],
            explicitProperties: [],
          },
        });
      });
    return () => {
      active = false;
    };
  }, [configuration, repository, selected, viewKey]);
  const visibleExecution =
    execution?.view.key === selected?.key ? execution : null;
  const currentSort =
    sourceSort && sourceSort.key === selected?.key
      ? sourceSort.sort
      : (selected?.sort ?? visibleExecution?.view.sort);
  const manualOrder = manualOrderConfiguration(
    currentSort,
    configuration.fieldMapping.sortOrder,
  );
  const selectedIsTaskList =
    selected?.presentation?.type === "tasknotes.task-list";
  const reorderMode =
    Boolean(manualOrder) &&
    selectedIsTaskList &&
    reorderingView === selected.key;
  const selectedManualOrderOperations = [...manualOrderPending.values()].filter(
    ({ viewKey: pendingViewKey }) => pendingViewKey === selected?.key,
  );
  const manualOrderPendingForSelected =
    selectedManualOrderOperations.length > 0;
  const manualOrderPendingTaskIds = new Set(
    selectedManualOrderOperations.map(({ taskId }) => taskId),
  );
  const presentedExecution = useMemo(
    () =>
      visibleExecution && manualOrder
        ? executionWithManualRanks(
            visibleExecution,
            manualRanks,
            selected?.key ?? "",
            manualOrder,
            configuration.fieldMapping.sortOrder,
          )
        : visibleExecution,
    [
      configuration.fieldMapping.sortOrder,
      manualOrder,
      manualRanks,
      selected?.key,
      visibleExecution,
    ],
  );
  const currentExecutionRefreshing =
    refreshingExecution ===
    (selected ? `${selected.key}:${selected.source.revision}` : null);
  const currentExecutionError =
    executionError && executionError.key === selected?.key
      ? executionError.message
      : "";
  const error = viewKey ? currentExecutionError || viewsError : viewsError;
  const currentViewActionError =
    viewActionError && viewActionError.viewKey === selected?.key
      ? viewActionError.message
      : "";
  const currentCreationPlan =
    creationPlan &&
    creationPlan.key === selected?.key &&
    creationPlan.revision === selected.source.revision
      ? creationPlan.plan
      : null;
  const currentCreationContext =
    creationContext?.key === selected?.key ? creationContext : null;
  const currentCalendarSelection =
    calendarSelection && calendarSelection.key === selected?.key
      ? calendarSelection.date
      : todayString();
  const currentCalendarCreateValue =
    calendarSelection && calendarSelection.key === selected?.key
      ? calendarSelection.createValue
      : currentCalendarSelection;
  const calendarCreateDefaults =
    selected?.presentation?.type === "tasknotes.calendar" ||
    selected?.presentation?.type === "tasknotes.mini-calendar"
      ? calendarDateDefaults(selected, currentCalendarCreateValue)
      : {};
  const manualCreateRank =
    manualOrder && presentedExecution
      ? appendManualOrderRank(
          presentedExecution.rows.map(({ task }) => task),
          manualOrder.direction,
        )
      : undefined;
  const captureDefaults =
    selected?.presentation?.options.create === false
      ? null
      : selected?.presentation?.type === "tasknotes.projects" &&
          !currentCreationContext
        ? null
        : currentCreationPlan
          ? mergeTaskCreationDefaults(
              {
                ...currentCreationPlan.defaults,
                ...(manualCreateRank ? { sortOrder: manualCreateRank } : {}),
              },
              mergeTaskCreationDefaults(
                calendarCreateDefaults,
                currentCreationContext?.defaults ?? {},
              ),
            )
          : null;
  const presentationClass =
    selected?.presentation?.type === "tasknotes.task-list"
      ? " is-task-list-view"
      : selected?.presentation?.type === "tasknotes.calendar"
        ? " is-full-calendar-view"
        : selected?.presentation?.type === "tasknotes.mini-calendar"
          ? " is-mini-calendar-view"
          : "";

  async function reorderTasks(
    rows: readonly TaskViewRow[],
    dragged: TaskViewRow,
    targetId: string | undefined,
    placement: ManualOrderPlacement,
    additionalInput: UpdateTaskInput = {},
  ) {
    if (!selected || !manualOrder) return;
    const plan = planManualOrder(
      rows.map(({ task }) => task),
      dragged.task,
      targetId,
      placement,
      manualOrder.direction,
    );
    const draggedWrite = plan.writes.find(
      ({ taskId }) => taskId === dragged.task.id,
    );
    if (!plan.writes.length && !Object.keys(additionalInput).length) return;
    const operationId = manualOrderMutationSequence.current + 1;
    manualOrderMutationSequence.current = operationId;
    const view = selected;

    setViewActionError(null);
    setManualOrderPending((pending) => {
      const next = new Map(pending);
      next.set(operationId, {
        viewKey: view.key,
        taskId: dragged.task.id,
      });
      return next;
    });
    setManualRanks((current) => {
      const next = new Map(current);
      for (const write of plan.writes)
        next.set(write.taskId, {
          viewKey: view.key,
          sortOrder: write.sortOrder,
          operationId,
        });
      return next;
    });
    selectionFeedback();

    const operation = manualOrderMutationQueue.current.then(async () => {
      try {
        await updateTasks([
          ...plan.writes
            .filter(({ taskId }) => taskId !== dragged.task.id)
            .map(({ taskId, sortOrder }) => ({
              id: taskId,
              input: { sortOrder },
            })),
          {
            id: dragged.task.id,
            input: {
              ...additionalInput,
              ...(draggedWrite ? { sortOrder: draggedWrite.sortOrder } : {}),
            },
          },
        ]);
        const refreshed = await repository.executeView(view);
        if (selectedKeyRef.current === view.key) {
          setExecution(refreshed);
          setExecutionError(null);
        }
      } catch (reason) {
        if (selectedKeyRef.current === view.key) {
          setViewActionError({
            viewKey: view.key,
            message: `Could not ${Object.keys(additionalInput).length ? "move" : "reorder"} “${dragged.task.title}”. ${message(reason)}`,
          });
          void repository
            .executeView(view)
            .then((refreshed) => {
              if (selectedKeyRef.current === view.key) setExecution(refreshed);
            })
            .catch(() => {
              // The original mutation error is more useful than a refresh error.
            });
        }
      } finally {
        setManualRanks((current) => {
          const next = new Map(current);
          for (const write of plan.writes) {
            if (next.get(write.taskId)?.operationId === operationId)
              next.delete(write.taskId);
          }
          return next;
        });
        setManualOrderPending((pending) => {
          if (!pending.has(operationId)) return pending;
          const next = new Map(pending);
          next.delete(operationId);
          return next;
        });
      }
    });
    manualOrderMutationQueue.current = operation.catch(() => undefined);
    await operation;
  }

  async function moveBoardTask(
    row: TaskViewRow,
    property: string,
    value: unknown,
    order?: {
      rows: TaskViewRow[];
      targetId?: string;
      placement: ManualOrderPlacement;
    },
  ) {
    if (!selected) return;
    const optimistic = boardMoves.get(row.task.id);
    const current =
      optimistic?.viewKey === selected.key && optimistic.property === property
        ? optimistic.value
        : (row.values[property] ?? row.task.frontmatter[property] ?? null);
    const changesColumn = valueKey(current) !== valueKey(value);
    if (!changesColumn && !order) return;
    const input = changesColumn
      ? kanbanMoveInput(row.task, property, value, configuration.fieldMapping)
      : {};
    if (!input) {
      setViewActionError({
        viewKey: selected.key,
        message: `${propertyLabel(property)} is calculated by this view and cannot be changed here.`,
      });
      return;
    }
    const sequence = (boardMutationSequence.current.get(row.task.id) ?? 0) + 1;
    boardMutationSequence.current.set(row.task.id, sequence);

    if (manualOrder && order) {
      if (changesColumn)
        setBoardMoves((moves) => {
          const next = new Map(moves);
          next.set(row.task.id, {
            viewKey: selected.key,
            property,
            value,
            sequence,
          });
          return next;
        });
      try {
        await reorderTasks(
          order.rows,
          row,
          order.targetId,
          order.placement,
          changesColumn ? input : {},
        );
      } finally {
        clearBoardMove(row.task.id, sequence);
      }
      return;
    }

    setViewActionError(null);
    setBoardMoves((moves) => {
      const next = new Map(moves);
      next.set(row.task.id, {
        viewKey: selected.key,
        property,
        value,
        sequence,
      });
      return next;
    });
    selectionFeedback();

    const previousMutation =
      boardMutationQueues.current.get(row.task.id) ?? Promise.resolve();
    const mutation = previousMutation
      .catch(() => undefined)
      .then(() => updateTask(row.task.id, input))
      .then(() => undefined);
    boardMutationQueues.current.set(row.task.id, mutation);

    try {
      await mutation;
    } catch (reason) {
      if (boardMutationSequence.current.get(row.task.id) !== sequence) return;
      clearBoardMove(row.task.id, sequence);
      if (selectedKeyRef.current === selected.key)
        setViewActionError({
          viewKey: selected.key,
          message: `Could not move “${row.task.title}”. ${message(reason)}`,
        });
      return;
    } finally {
      if (boardMutationQueues.current.get(row.task.id) === mutation)
        boardMutationQueues.current.delete(row.task.id);
    }

    if (boardMutationSequence.current.get(row.task.id) !== sequence) return;
    try {
      const refreshed = await repository.executeView(selected);
      if (boardMutationSequence.current.get(row.task.id) !== sequence) return;
      clearBoardMove(row.task.id, sequence);
      if (selectedKeyRef.current !== selected.key) return;
      setExecution(refreshed);
      setExecutionError(null);
    } catch (reason) {
      if (boardMutationSequence.current.get(row.task.id) !== sequence) return;
      clearBoardMove(row.task.id, sequence);
      if (selectedKeyRef.current === selected.key)
        setViewActionError({
          viewKey: selected.key,
          message: `The move was saved, but this view could not refresh. ${message(reason)}`,
        });
    }
  }

  function clearBoardMove(taskId: string, sequence?: number) {
    setBoardMoves((moves) => {
      const move = moves.get(taskId);
      if (!move || (sequence !== undefined && move.sequence !== sequence))
        return moves;
      const next = new Map(moves);
      next.delete(taskId);
      return next;
    });
  }

  async function refreshAfterCreate(task: Task) {
    if (!selected) return;
    const sync = await repository.syncStatus();
    const replicated = sync.mode === "replicated";
    if (replicated) {
      await repository.refresh();
      const settled = await repository.syncStatus();
      if (
        settled.state !== "synced" ||
        settled.pending > 0 ||
        settled.issues > 0
      )
        return {
          message: "Task created. This view will check for it after syncing.",
        };
    }
    let refreshed = await repository.executeView(selected);
    if (replicated && !refreshed.rows.some((row) => row.task.id === task.id))
      // A pre-sync refresh may still have occupied the repository's in-flight
      // execution slot. Once it settles, one fresh execution is authoritative.
      refreshed = await repository.executeView(selected);
    if (selectedKeyRef.current === selected.key) {
      setExecution(refreshed);
      setExecutionError(null);
      setCreationContext(null);
    }
    return refreshed.rows.some((row) => row.task.id === task.id)
      ? undefined
      : {
          message:
            "Task created, but this view does not show it. Its filters or result limit may exclude it.",
        };
  }

  async function updateCalendarTask(task: Task, input: UpdateTaskInput) {
    await updateTask(task.id, input);
    if (!selected) return;
    void repository.executeView(selected).then(
      (refreshed) => {
        if (selectedKeyRef.current !== selected.key) return;
        setExecution(refreshed);
        setExecutionError(null);
      },
      (reason) => {
        if (selectedKeyRef.current !== selected.key) return;
        setExecutionError({ key: selected.key, message: message(reason) });
      },
    );
  }

  function createInBoardColumn(
    property: string,
    value: unknown,
    label: string,
  ) {
    if (!selected) return;
    setCreationContext({
      key: selected.key,
      label,
      defaults: propertiesToCreateDefaults(
        { [property]: value },
        configuration,
      ),
      focusRequest: Date.now(),
    });
  }

  function canCreateInBoardColumn(property: string, value: unknown) {
    return (
      Object.keys(
        propertiesToCreateDefaults({ [property]: value }, configuration),
      ).length > 0
    );
  }

  if (!viewKey) {
    return (
      <>
        <section className="screen views-screen" aria-labelledby="views-title">
          <header className="screen-header compact-header views-catalog-header">
            <div>
              <p className="eyebrow">Your collection</p>
              <h1 id="views-title">Views</h1>
            </div>
            <div className="views-header-actions">
              <button
                aria-label="Create view"
                className="icon-action"
                type="button"
                onFocus={preloadViewEditor}
                onClick={() => setEditing("new")}
                onPointerEnter={preloadViewEditor}
              >
                <Plus aria-hidden="true" size={20} strokeWidth={1.7} />
              </button>
              <button
                aria-label="Search tasks"
                className="icon-action"
                type="button"
                onClick={onSearch}
              >
                <Search aria-hidden="true" size={20} strokeWidth={1.7} />
              </button>
            </div>
          </header>
          {error ? <p className="inline-error">{error}</p> : null}
          {!documents || !views ? (
            <LoadingRows count={4} />
          ) : views.length ? (
            <div className="view-catalog">
              <NavigationViewOrder
                keys={navigationViewKeys}
                views={views}
                onMove={onMoveNavigationView}
              />
              <div className="view-document-list">
                {documents.map((document) => (
                  <section
                    className="view-document"
                    key={document.source.path}
                    aria-labelledby={`view-document-${safeId(document.id)}`}
                  >
                    <header className="view-document-heading">
                      <h2 id={`view-document-${safeId(document.id)}`}>
                        {document.name}
                      </h2>
                      <small>{document.source.path}</small>
                    </header>
                    <div className="saved-view-list">
                      {document.views.map((view) => {
                        const inNavigation = navigationViewKeys.includes(
                          view.key,
                        );
                        const lastNavigationView =
                          inNavigation && navigationViewKeys.length === 1;
                        return (
                          <div className="saved-view-row" key={view.key}>
                            <button
                              className="saved-view-open"
                              type="button"
                              onClick={() => onOpenView(view)}
                            >
                              <ViewIcon view={view} />
                              <span>
                                <strong>{view.name}</strong>
                              </span>
                              <ChevronRight aria-hidden="true" size={18} />
                            </button>
                            {view.source.writable ? (
                              <button
                                aria-label={`Edit ${view.name}`}
                                className="saved-view-edit"
                                type="button"
                                onFocus={preloadViewEditor}
                                onClick={() => setEditing(view)}
                                onPointerEnter={preloadViewEditor}
                              >
                                <Pencil aria-hidden="true" size={16} />
                              </button>
                            ) : null}
                            <button
                              aria-label={
                                lastNavigationView
                                  ? `${view.name} must remain in navigation until another view is added`
                                  : inNavigation
                                    ? `Remove ${view.name} from navigation`
                                    : `Add ${view.name} to navigation`
                              }
                              aria-pressed={inNavigation}
                              className="saved-view-pin"
                              disabled={lastNavigationView}
                              type="button"
                              onClick={() => {
                                selectionFeedback();
                                onToggleNavigationView(view.key);
                              }}
                            >
                              <Pin
                                aria-hidden="true"
                                fill={inNavigation ? "currentColor" : "none"}
                                size={17}
                              />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : (
            <div className="plain-empty">
              <h2>No saved views yet</h2>
              <p>
                Create a focused list, board, or calendar for this collection.
              </p>
              <button
                className="outline-action"
                type="button"
                onFocus={preloadViewEditor}
                onClick={() => setEditing("new")}
                onPointerEnter={preloadViewEditor}
              >
                <Plus aria-hidden="true" size={17} />
                Create your first view
              </button>
            </div>
          )}
        </section>
        {editing ? (
          <ViewEditor
            view={editing === "new" ? undefined : editing}
            onClose={() => setEditing(null)}
            onChanged={onViewsChanged}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <section
        className={`screen views-screen view-detail${
          captureDefaults &&
          selected?.presentation?.type === "tasknotes.task-list"
            ? " has-list-capture"
            : ""
        }${presentationClass}`}
      >
        <header className={`view-header${operational ? " operational" : ""}`}>
          {!operational ? (
            <button className="back-action" type="button" onClick={onBack}>
              <ChevronLeft aria-hidden="true" size={20} />
              Views
            </button>
          ) : null}
          <div>
            <h1>{selected?.name ?? "Saved view"}</h1>
            {!indexing.complete ? (
              <small aria-live="polite" role="status">
                {localIndexingLabel(indexing)}
              </small>
            ) : visibleExecution && currentExecutionRefreshing ? (
              <span
                aria-live="polite"
                className="visually-hidden"
                role="status"
              >
                Updating view
              </span>
            ) : visibleExecution?.stale ? (
              <small aria-live="polite" role="status">
                Last available result
              </small>
            ) : null}
          </div>
          {!editing &&
          ((manualOrder && selectedIsTaskList) ||
            selected?.source.writable ||
            operational) ? (
            <div className="view-header-actions">
              {operational ? (
                <button
                  aria-label="Search tasks"
                  className="view-header-action"
                  type="button"
                  onClick={onSearch}
                >
                  <Search aria-hidden="true" size={18} />
                </button>
              ) : null}
              {manualOrder && selectedIsTaskList ? (
                <button
                  aria-label={
                    reorderMode ? "Finish reordering" : "Reorder tasks"
                  }
                  aria-pressed={reorderMode}
                  className="view-header-action"
                  type="button"
                  onClick={() =>
                    setReorderingView(reorderMode ? null : selected.key)
                  }
                >
                  <GripVertical aria-hidden="true" size={18} />
                </button>
              ) : null}
              {selected?.source.writable ? (
                <button
                  aria-label={`Edit ${selected.name}`}
                  className="edit-view-action"
                  type="button"
                  onFocus={preloadViewEditor}
                  onClick={() => setEditing(selected)}
                  onPointerEnter={preloadViewEditor}
                >
                  <Pencil aria-hidden="true" size={18} />
                </button>
              ) : null}
            </div>
          ) : null}
        </header>
        {!indexing.complete ? (
          <p className="indexing-detail" role="status">
            Results will appear while TaskNotes finishes checking this
            collection.
          </p>
        ) : null}
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        {currentViewActionError ? (
          <p className="inline-error" role="alert">
            {currentViewActionError}
          </p>
        ) : null}
        {editing && editing !== "new" ? (
          <ViewEditor
            view={editing}
            onClose={() => setEditing(null)}
            onChanged={onViewsChanged}
          />
        ) : null}
        {captureDefaults ? (
          <TaskCapture
            key={selected?.key}
            configuration={configuration}
            createTask={createTask}
            completeField={completeField}
            defaults={captureDefaults}
            focusRequest={currentCreationContext?.focusRequest}
            placeholder={
              currentCreationContext
                ? `Add to ${currentCreationContext.label}`
                : `Add to ${selected?.name ?? "this view"}`
            }
            onCreated={refreshAfterCreate}
            onOpenCreated={onOpenTask}
          />
        ) : null}
        {!presentedExecution ? (
          <LoadingRows count={6} />
        ) : presentedExecution.view.presentation?.type ===
          "tasknotes.projects" ? (
          <ProjectsView
            execution={presentedExecution}
            linkWriteFormat={configuration.linkWriteFormat}
            projectsField={configuration.fieldMapping.projects}
            tasks={identityTasks}
            onCreate={(value, label) =>
              selected &&
              setCreationContext({
                key: selected.key,
                label,
                defaults: { projects: [value] },
                focusRequest: Date.now(),
              })
            }
            onOpen={onOpenTask}
            onToggle={(task, occurrenceDate) =>
              void toggleTask(task.id, occurrenceDate)
            }
          />
        ) : presentedExecution.view.presentation?.type ===
          "tasknotes.kanban" ? (
          <KanbanView
            fieldMapping={configuration.fieldMapping}
            execution={presentedExecution}
            manualOrder={manualOrder}
            orderPending={manualOrderPendingForSelected}
            orderPendingTaskIds={manualOrderPendingTaskIds}
            moves={
              new Map(
                [...boardMoves].filter(
                  ([, move]) => move.viewKey === selected?.key,
                ),
              )
            }
            statusColumns={[...configuration.statuses]
              .sort((left, right) => left.order - right.order)
              .map(({ value, label }) => ({ value, label }))}
            priorityColumns={[...configuration.priorities]
              .sort((left, right) => left.weight - right.weight)
              .map(({ value, label }) => ({ value, label }))}
            onMove={(row, property, value, order) =>
              void moveBoardTask(row, property, value, order)
            }
            onCreateInColumn={createInBoardColumn}
            canCreateInColumn={canCreateInBoardColumn}
            onOpen={onOpenTask}
            onToggle={(task, occurrenceDate) =>
              void toggleTask(task.id, occurrenceDate)
            }
          />
        ) : presentedExecution.view.presentation?.type ===
          "tasknotes.calendar" ? (
          <Suspense fallback={<LoadingRows count={6} />}>
            <FullCalendarView
              key={`${presentedExecution.view.key}:${presentedExecution.view.source.revision}`}
              execution={presentedExecution}
              identityTasks={identityTasks}
              selected={currentCalendarSelection}
              titleProperty={configuration.fieldMapping.title}
              onSelect={(date, createValue = date) =>
                selected &&
                setCalendarSelection({
                  key: selected.key,
                  date,
                  createValue,
                })
              }
              onOpen={onOpenTask}
              onToggle={(task, occurrenceDate) =>
                void toggleTask(task.id, occurrenceDate)
              }
              onUpdate={updateCalendarTask}
            />
          </Suspense>
        ) : presentedExecution.view.presentation?.type ===
          "tasknotes.mini-calendar" ? (
          <MiniCalendarView
            key={`${presentedExecution.view.key}:${presentedExecution.view.source.revision}`}
            execution={presentedExecution}
            identityTasks={identityTasks}
            selected={currentCalendarSelection}
            titleProperty={configuration.fieldMapping.title}
            onSelect={(date) =>
              selected &&
              setCalendarSelection({
                key: selected.key,
                date,
                createValue: date,
              })
            }
            onOpen={onOpenTask}
            onToggle={(task, occurrenceDate) =>
              void toggleTask(task.id, occurrenceDate)
            }
          />
        ) : (
          <TaskListView
            collectionComplete={indexing.complete}
            execution={presentedExecution}
            manualOrder={manualOrder}
            orderPending={manualOrderPendingForSelected}
            reorderMode={reorderMode}
            titleProperty={configuration.fieldMapping.title}
            onReorder={(rows, dragged, targetId, placement) =>
              void reorderTasks(rows, dragged, targetId, placement)
            }
            onOpen={onOpenTask}
            onToggle={(task, occurrenceDate) =>
              void toggleTask(task.id, occurrenceDate)
            }
          />
        )}
      </section>
    </>
  );
}

function NavigationViewOrder({
  keys,
  views,
  onMove,
}: {
  keys: string[];
  views: TaskView[];
  onMove(key: string, direction: -1 | 1): void;
}) {
  const ordered = keys.flatMap((key) => {
    const view = views.find((candidate) => candidate.key === key);
    return view ? [view] : [];
  });
  return (
    <section
      className="navigation-view-order"
      aria-labelledby="navigation-view-order-title"
    >
      <header>
        <div>
          <h2 id="navigation-view-order-title">Navigation</h2>
          <p>The first view opens when TaskNotes starts.</p>
        </div>
      </header>
      <ol>
        {ordered.map((view, index) => (
          <li key={view.key}>
            <ViewIcon view={view} />
            <span>{view.name}</span>
            <div className="navigation-order-actions">
              <button
                aria-label={`Move ${view.name} earlier`}
                disabled={index === 0}
                type="button"
                onClick={() => onMove(view.key, -1)}
              >
                <ChevronUp aria-hidden="true" size={17} />
              </button>
              <button
                aria-label={`Move ${view.name} later`}
                disabled={index === ordered.length - 1}
                type="button"
                onClick={() => onMove(view.key, 1)}
              >
                <ChevronDown aria-hidden="true" size={17} />
              </button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function KanbanView({
  execution,
  fieldMapping,
  manualOrder,
  orderPending,
  orderPendingTaskIds,
  moves,
  priorityColumns,
  statusColumns,
  onMove,
  onCreateInColumn,
  canCreateInColumn,
  onOpen,
  onToggle,
}: ViewProps & {
  fieldMapping: KanbanFieldMapping;
  manualOrder: ManualOrderConfiguration | null;
  orderPending: boolean;
  orderPendingTaskIds: ReadonlySet<string>;
  moves: Map<
    string,
    {
      viewKey: string;
      property: string;
      value: unknown;
      sequence: number;
    }
  >;
  priorityColumns: Array<{ value: string; label: string }>;
  statusColumns: Array<{ value: string; label: string }>;
  onMove(
    row: TaskViewRow,
    property: string,
    value: unknown,
    order?: {
      rows: TaskViewRow[];
      targetId?: string;
      placement: ManualOrderPlacement;
    },
  ): void;
  onCreateInColumn(property: string, value: unknown, label: string): void;
  canCreateInColumn(property: string, value: unknown): boolean;
}) {
  const property = execution.view.presentation?.mappings.column ?? "status";
  const columns = new Map<
    string,
    { value: unknown; label?: string; rows: typeof execution.rows }
  >();
  const propertyName = kanbanPropertyRole(property, fieldMapping);
  const configuredColumns =
    propertyName === "status"
      ? statusColumns
      : propertyName === "priority"
        ? priorityColumns
        : [];
  for (const configured of configuredColumns)
    columns.set(valueKey(configured.value), {
      value: configured.value,
      label: configured.label,
      rows: [],
    });
  if (propertyName === "completed" || propertyName === "archived") {
    for (const configured of [
      { value: false, label: propertyName === "archived" ? "Active" : "Open" },
      {
        value: true,
        label: propertyName === "archived" ? "Archived" : "Complete",
      },
    ])
      columns.set(valueKey(configured.value), {
        value: configured.value,
        label: configured.label,
        rows: [],
      });
  }
  for (const group of execution.groups) {
    const value = group.values[property] ?? null;
    const existing = columns.get(valueKey(value));
    columns.set(valueKey(value), existing ?? { value, rows: [] });
  }
  for (const row of execution.rows) {
    const value =
      moves.get(row.task.id)?.property === property
        ? moves.get(row.task.id)!.value
        : (row.values[property] ?? row.task.frontmatter[property] ?? null);
    const key = valueKey(value);
    const column = columns.get(key) ?? { value, rows: [] };
    column.rows.push(row);
    columns.set(key, column);
  }
  const orderedColumns = [...columns.values()];
  const writable = propertyName !== null;
  const movable = writable || Boolean(manualOrder);
  const [dragging, setDragging] = useState<{
    row: TaskViewRow;
    sourceKey: string;
    preview: {
      width: number;
      x: number;
      y: number;
      offsetX: number;
      offsetY: number;
    };
  } | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [overDrop, setOverDrop] = useState<{
    columnKey: string;
    targetId?: string;
    placement: ManualOrderPlacement;
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const boardRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{
    row: TaskViewRow;
    sourceKey: string;
  } | null>(null);
  const pointerDrag = useRef<{
    pointerId: number;
    row: TaskViewRow;
    sourceKey: string;
    card: HTMLDivElement;
    startX: number;
    startY: number;
    x: number;
    y: number;
    width: number;
    offsetX: number;
    offsetY: number;
    pointerType: string;
    active: boolean;
    pressTimer: number | null;
  } | null>(null);
  const pointerPosition = useRef<{ x: number; y: number } | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const suppressedClickTaskId = useRef<string | null>(null);
  const suppressedClickTimer = useRef<number | null>(null);
  const overDropRef = useRef<typeof overDrop>(null);
  const autoScrollFrame = useRef<number | null>(null);
  const touchMoveBlocker = useRef<((event: TouchEvent) => void) | null>(null);

  useEffect(
    () => () => {
      if (autoScrollFrame.current !== null)
        cancelAnimationFrame(autoScrollFrame.current);
      const pointer = pointerDrag.current;
      if (pointer?.pressTimer != null) window.clearTimeout(pointer.pressTimer);
      if (touchMoveBlocker.current)
        document.removeEventListener("touchmove", touchMoveBlocker.current, {
          capture: true,
        });
      if (suppressedClickTimer.current !== null)
        window.clearTimeout(suppressedClickTimer.current);
    },
    [],
  );

  function beginMove(
    row: TaskViewRow,
    sourceKey: string,
    pointer: NonNullable<typeof pointerDrag.current>,
  ) {
    const active = { row, sourceKey };
    draggingRef.current = active;
    setDragging({
      ...active,
      preview: {
        width: pointer.width,
        x: pointer.x,
        y: pointer.y,
        offsetX: pointer.offsetX,
        offsetY: pointer.offsetY,
      },
    });
    setOverKey(null);
    setAnnouncement(`Moving ${row.task.title}.`);
  }

  function clearDrag() {
    if (autoScrollFrame.current !== null) {
      cancelAnimationFrame(autoScrollFrame.current);
      autoScrollFrame.current = null;
    }
    const pointer = pointerDrag.current;
    if (pointer?.pressTimer != null) window.clearTimeout(pointer.pressTimer);
    if (pointer?.card.hasPointerCapture(pointer.pointerId))
      pointer.card.releasePointerCapture(pointer.pointerId);
    if (touchMoveBlocker.current) {
      document.removeEventListener("touchmove", touchMoveBlocker.current, {
        capture: true,
      });
      touchMoveBlocker.current = null;
    }
    draggingRef.current = null;
    pointerDrag.current = null;
    pointerPosition.current = null;
    setDragging(null);
    setOverKey(null);
    setOverDrop(null);
    overDropRef.current = null;
  }

  function activatePointerDrag(
    pointer: NonNullable<typeof pointerDrag.current>,
  ) {
    if (pointerDrag.current !== pointer || pointer.active) return;
    if (pointer.pressTimer !== null) {
      window.clearTimeout(pointer.pressTimer);
      pointer.pressTimer = null;
    }
    pointer.active = true;
    pointer.card.setPointerCapture(pointer.pointerId);
    if (pointer.pointerType !== "mouse") {
      const preventTouchMove = (event: TouchEvent) => event.preventDefault();
      touchMoveBlocker.current = preventTouchMove;
      document.addEventListener("touchmove", preventTouchMove, {
        capture: true,
        passive: false,
      });
    }
    pointerPosition.current = { x: pointer.x, y: pointer.y };
    suppressedClickTaskId.current = pointer.row.task.id;
    if (suppressedClickTimer.current !== null)
      window.clearTimeout(suppressedClickTimer.current);
    suppressedClickTimer.current = window.setTimeout(() => {
      suppressedClickTaskId.current = null;
      suppressedClickTimer.current = null;
    }, 700);
    beginMove(pointer.row, pointer.sourceKey, pointer);
  }

  function positionPreview(pointer: NonNullable<typeof pointerDrag.current>) {
    const preview = previewRef.current;
    if (!preview) return;
    preview.style.transform = kanbanPreviewTransform(
      pointer.x,
      pointer.y,
      pointer.offsetX,
      pointer.offsetY,
      pointer.width,
    );
  }

  function updateDropFeedback(next: typeof overDropRef.current) {
    const current = overDropRef.current;
    if (
      current?.columnKey !== next?.columnKey ||
      current?.targetId !== next?.targetId ||
      current?.placement !== next?.placement
    ) {
      overDropRef.current = next;
      setOverDrop(next);
    }
    const nextKey = next?.columnKey ?? null;
    setOverKey((currentKey) => (currentKey === nextKey ? currentKey : nextKey));
  }

  function finishMove(
    row: TaskViewRow,
    sourceKey: string,
    drop: {
      columnKey: string;
      targetId?: string;
      placement: ManualOrderPlacement;
    } | null,
  ) {
    const destination = orderedColumns.find(
      (column) => valueKey(column.value) === drop?.columnKey,
    );
    const changesColumn = drop?.columnKey !== sourceKey;
    if (
      destination &&
      ((!changesColumn && manualOrder) || (changesColumn && writable))
    ) {
      onMove(
        row,
        property,
        destination.value,
        manualOrder
          ? {
              rows: destination.rows,
              targetId: drop?.targetId,
              placement: drop?.placement ?? "after",
            }
          : undefined,
      );
      setAnnouncement(
        changesColumn
          ? `Moved ${row.task.title} to ${destination.label ?? columnLabel(destination.value)}.`
          : `Reordered ${row.task.title}.`,
      );
    }
    clearDrag();
  }

  function dropAt(
    clientX: number,
    clientY: number,
  ): typeof overDropRef.current {
    const board = boardRef.current;
    const bounds = board?.getBoundingClientRect();
    if (
      bounds &&
      bounds.width > 0 &&
      bounds.height > 0 &&
      (clientX < bounds.left ||
        clientX > bounds.right ||
        clientY < Math.max(0, bounds.top) ||
        clientY > Math.min(window.innerHeight, bounds.bottom))
    )
      return null;
    const element = document.elementFromPoint(clientX, clientY);
    const column = element?.closest<HTMLElement>("[data-kanban-column-key]");
    const columnKey = column?.dataset.kanbanColumnKey;
    if (!columnKey) return null;
    const active = draggingRef.current;
    if (!active || (!manualOrder && columnKey === active.sourceKey))
      return null;
    if (!manualOrder) return { columnKey, placement: "after" };
    const card = element?.closest<HTMLElement>("[data-kanban-card-id]");
    const targetId = card?.dataset.kanbanCardId;
    if (targetId === draggingRef.current?.row.task.id) return null;
    if (!targetId) return { columnKey, placement: "after" };
    const cardBounds = card.getBoundingClientRect();
    return {
      columnKey,
      targetId,
      placement:
        clientY < cardBounds.top + cardBounds.height / 2 ? "before" : "after",
    };
  }

  function continueAutoScroll() {
    autoScrollFrame.current = null;
    const board = boardRef.current;
    const pointer = pointerPosition.current;
    if (!board || !pointer || !pointerDrag.current) return;
    const bounds = board.getBoundingClientRect();
    const horizontalDistance = edgeScrollDistance(
      pointer.x,
      bounds.left,
      bounds.right,
      52,
      18,
    );
    const verticalDistance = edgeScrollDistance(
      pointer.y,
      0,
      window.innerHeight,
      72,
      16,
    );
    if (!horizontalDistance && !verticalDistance) return;

    const previousLeft = board.scrollLeft;
    const previousTop = window.scrollY;
    if (horizontalDistance) board.scrollLeft += horizontalDistance;
    if (verticalDistance) window.scrollBy(0, verticalDistance);
    const drop = dropAt(pointer.x, pointer.y);
    updateDropFeedback(drop);
    if (board.scrollLeft !== previousLeft || window.scrollY !== previousTop)
      autoScrollFrame.current = requestAnimationFrame(continueAutoScroll);
  }

  function startAutoScroll() {
    if (autoScrollFrame.current === null)
      autoScrollFrame.current = requestAnimationFrame(continueAutoScroll);
  }

  function startCardPointer(
    event: ReactPointerEvent<HTMLDivElement>,
    row: TaskViewRow,
    sourceKey: string,
  ) {
    if (
      !movable ||
      !event.isPrimary ||
      event.button !== 0 ||
      pointerDrag.current ||
      kanbanDragControl(event.target)
    )
      return;
    const card = event.currentTarget;
    const bounds = card.getBoundingClientRect();
    const pointer = {
      pointerId: event.pointerId,
      row,
      sourceKey,
      card,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      width: bounds.width,
      offsetX: Math.min(
        Math.max(event.clientX - bounds.left, 12),
        Math.max(12, bounds.width - 12),
      ),
      offsetY: Math.min(
        Math.max(event.clientY - bounds.top, 12),
        Math.max(12, bounds.height - 12),
      ),
      pointerType: event.pointerType,
      active: false,
      pressTimer: null as number | null,
    };
    pointerDrag.current = pointer;
    if (event.pointerType !== "mouse") {
      pointer.pressTimer = window.setTimeout(() => {
        activatePointerDrag(pointer);
      }, 220);
    }
  }

  function moveCardPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const pointer = pointerDrag.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const distance = Math.hypot(
      pointer.x - pointer.startX,
      pointer.y - pointer.startY,
    );
    if (!pointer.active) {
      if (pointer.pointerType !== "mouse") {
        if (distance > 10) {
          if (pointer.pressTimer !== null)
            window.clearTimeout(pointer.pressTimer);
          pointerDrag.current = null;
        }
        return;
      }
      if (distance < 6) return;
      activatePointerDrag(pointer);
    }
    event.preventDefault();
    positionPreview(pointer);
    pointerPosition.current = { x: pointer.x, y: pointer.y };
    updateDropFeedback(dropAt(pointer.x, pointer.y));
    startAutoScroll();
  }

  function endCardPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const pointer = pointerDrag.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    if (!pointer.active) {
      if (pointer.pressTimer !== null) window.clearTimeout(pointer.pressTimer);
      pointerDrag.current = null;
      return;
    }
    event.preventDefault();
    finishMove(
      pointer.row,
      pointer.sourceKey,
      overDropRef.current ?? dropAt(event.clientX, event.clientY),
    );
  }

  function moveCardWithKeyboard(
    event: ReactKeyboardEvent<HTMLDivElement>,
    row: TaskViewRow,
    column: (typeof orderedColumns)[number],
    columnIndex: number,
  ) {
    if (event.target !== event.currentTarget) return;
    const direction =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (direction) {
      const destination = orderedColumns[columnIndex + direction];
      if (!destination || !writable) return;
      event.preventDefault();
      const rowIndex = column.rows.findIndex(
        ({ task }) => task.id === row.task.id,
      );
      const target =
        manualOrder && destination.rows.length
          ? destination.rows[
              Math.min(Math.max(rowIndex, 0), destination.rows.length - 1)
            ]
          : undefined;
      onMove(
        row,
        property,
        destination.value,
        manualOrder
          ? {
              rows: destination.rows,
              targetId: target?.task.id,
              placement: target ? "before" : "after",
            }
          : undefined,
      );
      setAnnouncement(
        `Moved ${row.task.title} to ${destination.label ?? columnLabel(destination.value)}.`,
      );
      return;
    }
    if (!manualOrder || (event.key !== "ArrowUp" && event.key !== "ArrowDown"))
      return;
    const rowIndex = column.rows.findIndex(
      ({ task }) => task.id === row.task.id,
    );
    const vertical = event.key === "ArrowUp" ? -1 : 1;
    const target = column.rows[rowIndex + vertical];
    if (!target) return;
    event.preventDefault();
    onMove(row, property, column.value, {
      rows: column.rows,
      targetId: target.task.id,
      placement: vertical < 0 ? "before" : "after",
    });
    setAnnouncement(`Moved ${row.task.title} ${vertical < 0 ? "up" : "down"}.`);
  }

  return (
    <>
      {!writable ? (
        <p className="view-note">
          This board groups by a calculated property, so cards cannot move
          between columns.
        </p>
      ) : null}
      <div
        aria-busy={orderPending || moves.size > 0}
        className={`kanban-board${dragging ? " is-dragging" : ""}`}
        aria-label={`${execution.view.name} board`}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !draggingRef.current) return;
          const title = draggingRef.current.row.task.title;
          event.preventDefault();
          clearDrag();
          setAnnouncement(`Cancelled moving ${title}.`);
        }}
        ref={boardRef}
      >
        {orderedColumns.map((column, columnIndex) => {
          const key = valueKey(column.value);
          const label = column.label ?? columnLabel(column.value);
          return (
            <section
              aria-label={`${label} column`}
              className={`kanban-column${overKey === key ? " is-drop-target" : ""}`}
              data-kanban-column-key={key}
              key={key}
            >
              <header>
                <h2>{label}</h2>
                <div>
                  <span>{column.rows.length}</span>
                  {writable && canCreateInColumn(property, column.value) ? (
                    <button
                      aria-label={`Add task to ${label}`}
                      className="kanban-column-add"
                      type="button"
                      onClick={() =>
                        onCreateInColumn(property, column.value, label)
                      }
                    >
                      <Plus aria-hidden="true" size={16} />
                    </button>
                  ) : null}
                </div>
              </header>
              <div className="kanban-column-cards">
                {column.rows.map((row) => {
                  const pending =
                    moves.has(row.task.id) ||
                    orderPendingTaskIds.has(row.task.id);
                  const draggingThisCard =
                    dragging?.row.task.id === row.task.id;
                  return (
                    <div
                      aria-label={
                        movable
                          ? manualOrder
                            ? `${row.task.title}. Drag to move. Use arrow keys to arrange.`
                            : `${row.task.title}. Drag to move between columns. Use left and right arrow keys.`
                          : undefined
                      }
                      aria-busy={pending}
                      className={`kanban-card${movable ? " is-movable" : ""}${pending ? " is-pending" : ""}${draggingThisCard ? " is-dragging" : ""}${manualOrder && overDrop?.targetId === row.task.id ? ` is-drop-${overDrop.placement}` : ""}`}
                      data-kanban-card-id={row.task.id}
                      key={row.task.id}
                      role={movable ? "group" : undefined}
                      tabIndex={movable ? 0 : undefined}
                      onClickCapture={(event) => {
                        if (suppressedClickTaskId.current !== row.task.id)
                          return;
                        suppressedClickTaskId.current = null;
                        if (suppressedClickTimer.current !== null) {
                          window.clearTimeout(suppressedClickTimer.current);
                          suppressedClickTimer.current = null;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onContextMenuCapture={(
                        event: ReactMouseEvent<HTMLDivElement>,
                      ) => {
                        const pointer = pointerDrag.current;
                        if (
                          pointer?.row.task.id !== row.task.id ||
                          (!pointer.active && pointer.pressTimer === null)
                        )
                          return;
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onKeyDown={(event) =>
                        moveCardWithKeyboard(event, row, column, columnIndex)
                      }
                      onPointerCancel={clearDrag}
                      onPointerDown={(event) =>
                        startCardPointer(event, row, key)
                      }
                      onPointerMove={moveCardPointer}
                      onPointerUp={endCardPointer}
                    >
                      <ViewTaskRow
                        row={row}
                        properties={execution.view.properties}
                        titleProperty={fieldMapping.title}
                        omittedProperties={[property]}
                        onOpen={onOpen}
                        onToggle={onToggle}
                      />
                    </div>
                  );
                })}
                {dragging &&
                column.rows.length === 0 &&
                (manualOrder || key !== dragging.sourceKey) ? (
                  <div
                    aria-hidden="true"
                    className={`kanban-empty-drop-zone${overKey === key ? " is-active" : ""}`}
                  >
                    Drop here
                  </div>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
      {dragging ? (
        <div
          aria-hidden="true"
          className="kanban-drag-preview"
          data-kanban-drag-preview
          ref={previewRef}
          style={{
            transform: kanbanPreviewTransform(
              dragging.preview.x,
              dragging.preview.y,
              dragging.preview.offsetX,
              dragging.preview.offsetY,
              dragging.preview.width,
            ),
            width: dragging.preview.width,
          }}
        >
          <span>{dragging.row.task.title}</span>
        </div>
      ) : null}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}

function kanbanDragControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest<HTMLElement>(
    "button, a, input, textarea, select, [contenteditable='true']",
  );
  return Boolean(control && !control.classList.contains("task-row-content"));
}

function kanbanPreviewTransform(
  pointerX: number,
  pointerY: number,
  offsetX: number,
  offsetY: number,
  width: number,
): string {
  const inset = 8;
  const x = Math.min(
    Math.max(pointerX - offsetX, inset),
    Math.max(inset, window.innerWidth - width - inset),
  );
  const y = Math.min(
    Math.max(pointerY - offsetY, inset),
    Math.max(inset, window.innerHeight - 82),
  );
  return `translate3d(${x}px, ${y}px, 0)`;
}

function edgeScrollDistance(
  position: number,
  start: number,
  end: number,
  edge: number,
  maximum: number,
): number {
  if (position < start + edge) {
    const intensity = Math.min(1, (start + edge - position) / edge);
    return -Math.max(4, Math.ceil(intensity * maximum));
  }
  if (position > end - edge) {
    const intensity = Math.min(1, (position - (end - edge)) / edge);
    return Math.max(4, Math.ceil(intensity * maximum));
  }
  return 0;
}

function MiniCalendarView({
  execution,
  identityTasks,
  selected,
  titleProperty,
  onSelect,
  onOpen,
  onToggle,
}: ViewProps & {
  identityTasks: readonly Task[];
  selected: string;
  titleProperty: string;
  onSelect(date: string): void;
}) {
  const initial = dateFromStorage(todayString()) ?? new Date();
  const [month, setMonth] = useState(
    () => new Date(initial.getFullYear(), initial.getMonth(), 1),
  );
  const [focusedDate, setFocusedDate] = useState(
    selected || storageDate(initial),
  );
  const dateRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusRequested = useRef(false);
  const days = useMemo(() => calendarGrid(month), [month]);
  const events = useMemo(
    () =>
      calendarEvents(execution, days[0], days.at(-1) ?? days[0], identityTasks),
    [days, execution, identityTasks],
  );
  const selectedTasks = events.get(selected) ?? [];
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(month);
  useEffect(() => {
    if (!focusRequested.current) return;
    dateRefs.current.get(focusedDate)?.focus();
    focusRequested.current = false;
  }, [focusedDate, month]);

  function moveFocus(day: Date) {
    focusRequested.current = true;
    if (
      day.getMonth() !== month.getMonth() ||
      day.getFullYear() !== month.getFullYear()
    )
      setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
    setFocusedDate(storageDate(day));
  }

  function chooseDate(day: Date) {
    const date = storageDate(day);
    setFocusedDate(date);
    onSelect(date);
  }

  function changeMonth(amount: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + amount, 1);
    setMonth(next);
    setFocusedDate(storageDate(next));
  }
  return (
    <div className="mini-calendar-view">
      <div className="mini-calendar-toolbar">
        <button
          aria-label="Previous month"
          type="button"
          onClick={() => changeMonth(-1)}
        >
          <ChevronLeft aria-hidden="true" size={20} />
        </button>
        <h2>{monthLabel}</h2>
        <button
          aria-label="Next month"
          type="button"
          onClick={() => changeMonth(1)}
        >
          <ChevronRight aria-hidden="true" size={20} />
        </button>
      </div>
      <div className="mini-calendar-weekdays" aria-hidden="true">
        {weekdays().map((day, index) => (
          <span key={`${day}:${index}`}>{day}</span>
        ))}
      </div>
      <div className="mini-calendar-grid" role="grid" aria-label={monthLabel}>
        {Array.from({ length: 6 }, (_, week) => (
          <div key={week} role="row">
            {days.slice(week * 7, week * 7 + 7).map((day) => {
              const date = storageDate(day);
              const entries = events.get(date) ?? [];
              const count = entries.length;
              return (
                <button
                  aria-label={`${day.toLocaleDateString()}, ${count} ${count === 1 ? "task" : "tasks"}`}
                  aria-selected={selected === date}
                  className={
                    day.getMonth() === month.getMonth() ? "" : "outside"
                  }
                  key={date}
                  ref={(element) => {
                    if (element) dateRefs.current.set(date, element);
                    else dateRefs.current.delete(date);
                  }}
                  role="gridcell"
                  tabIndex={focusedDate === date ? 0 : -1}
                  type="button"
                  onClick={() => chooseDate(day)}
                  onKeyDown={(event) => {
                    const movement = {
                      ArrowLeft: -1,
                      ArrowRight: 1,
                      ArrowUp: -7,
                      ArrowDown: 7,
                    }[event.key];
                    if (movement !== undefined) {
                      event.preventDefault();
                      moveFocus(addCalendarDays(day, movement));
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      moveFocus(addCalendarDays(day, -day.getDay()));
                    } else if (event.key === "End") {
                      event.preventDefault();
                      moveFocus(addCalendarDays(day, 6 - day.getDay()));
                    } else if (event.key === "PageUp") {
                      event.preventDefault();
                      moveFocus(addCalendarMonths(day, -1));
                    } else if (event.key === "PageDown") {
                      event.preventDefault();
                      moveFocus(addCalendarMonths(day, 1));
                    }
                  }}
                >
                  <span className="mini-calendar-date-number">
                    {day.getDate()}
                  </span>
                  {count ? (
                    <span
                      className="mini-calendar-cell-tasks"
                      aria-hidden="true"
                    >
                      {entries.slice(0, 3).map((entry) => (
                        <span
                          key={entry.occurrence?.key ?? entry.task.id}
                          className={entry.task.completed ? "is-complete" : ""}
                        >
                          {entry.task.title}
                        </span>
                      ))}
                      {count > 3 ? <small>+{count - 3} more</small> : null}
                    </span>
                  ) : null}
                  {count ? <i aria-hidden="true">{count}</i> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <section className="mini-calendar-agenda">
        <h2>{agendaLabel(selected)}</h2>
        {selectedTasks.length ? (
          selectedTasks.map((entry) => (
            <ViewTaskRow
              key={entry.occurrence?.key ?? entry.task.id}
              row={entry.row}
              properties={execution.view.properties}
              titleProperty={titleProperty}
              occurrence={entry.occurrence}
              onOpen={onOpen}
              onToggle={onToggle}
            />
          ))
        ) : (
          <p>No tasks on this day.</p>
        )}
      </section>
    </div>
  );
}

function addCalendarDays(date: Date, amount: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + amount,
    12,
  );
}

function addCalendarMonths(date: Date, amount: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

function calendarDateDefaults(
  view: TaskView,
  selectedDate: string,
): Partial<CreateTaskInput> {
  const options = view.presentation?.options ?? {};
  if (options.showScheduled !== false) return { scheduled: selectedDate };
  if (options.showDue !== false) return { due: selectedDate };
  return {};
}

function TaskListView({
  collectionComplete,
  execution,
  manualOrder,
  orderPending,
  reorderMode,
  titleProperty,
  onReorder,
  onOpen,
  onToggle,
}: ViewProps & {
  collectionComplete: boolean;
  manualOrder: ManualOrderConfiguration | null;
  orderPending: boolean;
  reorderMode: boolean;
  titleProperty: string;
  onReorder(
    rows: readonly TaskViewRow[],
    dragged: TaskViewRow,
    targetId: string | undefined,
    placement: ManualOrderPlacement,
  ): void;
}) {
  if (!execution.rows.length)
    return (
      <div className="plain-empty task-list-view">
        <h2>{collectionComplete ? "Nothing here" : "Indexing your tasks"}</h2>
        <p>
          {collectionComplete
            ? "This view has no matching tasks."
            : "Matching tasks will appear as they are found."}
        </p>
      </div>
    );
  const groups = groupTaskViewRows(execution);
  if (groups.length)
    return (
      <div className="task-groups saved-view-groups task-list-view">
        {groups.map((group) => (
          <section className="task-section" key={group.key}>
            <div className="section-heading">
              <h2>
                {Object.keys(group.values).length
                  ? groupLabel(Object.entries(group.values))
                  : "Other"}
              </h2>
              <span>{group.count}</span>
            </div>
            <ManualTaskRows
              className="saved-task-list"
              manualOrder={manualOrder}
              orderPending={orderPending}
              reorderMode={reorderMode}
              properties={execution.view.properties}
              rows={group.rows}
              titleProperty={titleProperty}
              onOpen={onOpen}
              onReorder={onReorder}
              onToggle={onToggle}
            />
          </section>
        ))}
      </div>
    );
  const sections = sectionTaskViewRows(
    execution.rows,
    execution.view.presentation?.options.sections,
  );
  if (sections.length)
    return (
      <div className="task-groups saved-view-groups task-list-view day-task-sections">
        {sections.map((section) => (
          <section
            className={`task-section is-${section.key}`}
            key={section.key}
          >
            <div className="section-heading">
              <h2>{section.label}</h2>
              <span>{section.rows.length}</span>
            </div>
            <ManualTaskRows
              className="saved-task-list"
              manualOrder={manualOrder}
              orderPending={orderPending}
              reorderMode={reorderMode}
              properties={execution.view.properties}
              rows={section.rows}
              titleProperty={titleProperty}
              onOpen={onOpen}
              onReorder={onReorder}
              onToggle={onToggle}
            />
          </section>
        ))}
      </div>
    );
  return (
    <ManualTaskRows
      className="saved-task-list task-list-view"
      manualOrder={manualOrder}
      orderPending={orderPending}
      reorderMode={reorderMode}
      properties={execution.view.properties}
      rows={execution.rows}
      titleProperty={titleProperty}
      onOpen={onOpen}
      onReorder={onReorder}
      onToggle={onToggle}
    />
  );
}

function ManualTaskRows({
  className,
  manualOrder,
  orderPending,
  reorderMode,
  properties,
  rows,
  titleProperty,
  onOpen,
  onReorder,
  onToggle,
}: {
  className: string;
  manualOrder: ManualOrderConfiguration | null;
  orderPending: boolean;
  reorderMode: boolean;
  properties: TaskViewProperty[];
  rows: TaskViewRow[];
  titleProperty: string;
  onOpen(task: Task, occurrenceDate?: string): void;
  onReorder(
    rows: readonly TaskViewRow[],
    dragged: TaskViewRow,
    targetId: string | undefined,
    placement: ManualOrderPlacement,
  ): void;
  onToggle(task: Task, occurrenceDate?: string): void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{
    targetId: string;
    placement: ManualOrderPlacement;
  } | null>(null);
  const dropRef = useRef(drop);
  const listRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");

  function updateDrop(clientX: number, clientY: number) {
    const element = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-manual-order-task]");
    if (!element || !listRef.current?.contains(element)) {
      dropRef.current = null;
      setDrop(null);
      return;
    }
    const targetId = element.dataset.manualOrderTask;
    if (!targetId || targetId === draggingId) return;
    const bounds = element.getBoundingClientRect();
    const next = {
      targetId,
      placement:
        clientY < bounds.top + bounds.height / 2
          ? ("before" as const)
          : ("after" as const),
    };
    dropRef.current = next;
    setDrop(next);
  }

  function finish(row: TaskViewRow) {
    const destination = dropRef.current;
    setDraggingId(null);
    dropRef.current = null;
    setDrop(null);
    if (!destination) return;
    onReorder(rows, row, destination.targetId, destination.placement);
    const target = rows.find(
      ({ task }) => task.id === destination.targetId,
    )?.task;
    if (target)
      setAnnouncement(
        `Moved ${row.task.title} ${destination.placement} ${target.title}.`,
      );
  }

  return (
    <>
      <div
        className={`${className}${manualOrder && reorderMode ? " manual-order-list" : ""}`}
        ref={listRef}
      >
        {rows.map((row, index) => (
          <div
            className={`manual-order-row${draggingId === row.task.id ? " is-dragging" : ""}${drop?.targetId === row.task.id ? ` is-drop-${drop.placement}` : ""}`}
            data-manual-order-task={row.task.id}
            key={row.task.id}
          >
            {manualOrder && reorderMode ? (
              <button
                aria-label={`Reorder ${row.task.title}. Drag, or use up and down arrow keys.`}
                className="manual-order-handle"
                disabled={orderPending}
                type="button"
                onKeyDown={(event) => {
                  const direction =
                    event.key === "ArrowUp"
                      ? -1
                      : event.key === "ArrowDown"
                        ? 1
                        : 0;
                  if (!direction) return;
                  const target = rows[index + direction];
                  if (!target) return;
                  event.preventDefault();
                  onReorder(
                    rows,
                    row,
                    target.task.id,
                    direction < 0 ? "before" : "after",
                  );
                  setAnnouncement(
                    `Moved ${row.task.title} ${direction < 0 ? "up" : "down"}.`,
                  );
                }}
                onPointerDown={(event) => {
                  if (orderPending) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDraggingId(row.task.id);
                }}
                onPointerMove={(event) => {
                  if (draggingId !== row.task.id) return;
                  event.preventDefault();
                  updateDrop(event.clientX, event.clientY);
                }}
                onPointerCancel={() => {
                  setDraggingId(null);
                  dropRef.current = null;
                  setDrop(null);
                }}
                onPointerUp={() => finish(row)}
              >
                <GripVertical aria-hidden="true" size={16} />
              </button>
            ) : null}
            <ViewTaskRow
              row={row}
              properties={properties}
              titleProperty={titleProperty}
              onOpen={onOpen}
              onToggle={onToggle}
            />
          </div>
        ))}
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}

function ProjectsView({
  execution,
  linkWriteFormat,
  projectsField,
  tasks,
  onCreate,
  onOpen,
  onToggle,
}: ViewProps & {
  projectsField: string;
  linkWriteFormat: "wikilink" | "markdown";
  tasks: readonly Task[];
  onCreate(value: string, label: string): void;
}) {
  const activeTasks = tasks.filter((task) => !task.completed && !task.archived);
  const records = indexProjectRecords(
    (execution.records ?? []).map(({ record }) => record),
  );
  const groups = new Map<
    string,
    { label: string; path?: string; value: string; tasks: Task[] }
  >();

  for (const task of activeTasks) {
    const values = task.projects.length
      ? task.projects
      : listStrings(task.frontmatter[projectsField]);
    for (const value of values) {
      const target = linkTarget(value);
      const normalizedTarget = target.toLocaleLowerCase();
      const matches = normalizedTarget.includes("/")
        ? (records.byPath.get(normalizedTarget) ?? [])
        : (records.byBasename.get(normalizedTarget) ?? []);
      if (matches.length) {
        for (const record of matches) {
          const key = `record:${record.path.toLocaleLowerCase()}`;
          const group = groups.get(key) ?? {
            label: record.label,
            path: record.path,
            value: recordCompletion(record, linkWriteFormat).value,
            tasks: [],
          };
          if (!group.tasks.some((candidate) => candidate.id === task.id))
            group.tasks.push(task);
          groups.set(key, group);
        }
        continue;
      }
      const key = `link:${target.toLocaleLowerCase()}`;
      const group = groups.get(key) ?? {
        label: target.split("/").at(-1) || value,
        value,
        tasks: [],
      };
      if (!group.tasks.some((candidate) => candidate.id === task.id))
        group.tasks.push(task);
      groups.set(key, group);
    }
  }

  const ordered = [...groups.values()].sort(
    (left, right) =>
      left.label.localeCompare(right.label) ||
      (left.path ?? "").localeCompare(right.path ?? ""),
  );
  if (!ordered.length)
    return (
      <div className="plain-empty">
        <h2>No active projects</h2>
        <p>Add a project to a task and it will appear here.</p>
      </div>
    );
  return (
    <div className="projects-view">
      {ordered.map((project) => (
        <section className="project-group" key={project.path ?? project.value}>
          <header>
            <div>
              <h2>{project.label}</h2>
              <small>
                {project.path ??
                  `${project.tasks.length} linked ${
                    project.tasks.length === 1 ? "task" : "tasks"
                  }`}
              </small>
            </div>
            <button
              aria-label={`Add task to ${project.label}`}
              type="button"
              onClick={() => onCreate(project.value, project.label)}
            >
              <Plus aria-hidden="true" size={16} />
              Add task
            </button>
          </header>
          <div className="saved-task-list">
            {project.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onOpen={onOpen}
                onToggle={onToggle}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function listStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : typeof value === "string"
      ? [value]
      : [];
}

function indexProjectRecords(records: readonly CollectionRecord[]): {
  byPath: Map<string, CollectionRecord[]>;
  byBasename: Map<string, CollectionRecord[]>;
} {
  const byPath = new Map<string, CollectionRecord[]>();
  const byBasename = new Map<string, CollectionRecord[]>();
  for (const record of records) {
    const path = linkTarget(record.path).toLocaleLowerCase();
    addIndexedRecord(byPath, path, record);
    addIndexedRecord(byBasename, path.split("/").at(-1) ?? path, record);
  }
  return { byPath, byBasename };
}

function addIndexedRecord(
  index: Map<string, CollectionRecord[]>,
  key: string,
  record: CollectionRecord,
): void {
  const values = index.get(key);
  if (values) values.push(record);
  else index.set(key, [record]);
}

function groupLabel(entries: Array<[string, unknown]>): string {
  if (entries.length === 1) {
    const [field, value] = entries[0];
    return (
      formatPropertyValue(value) ?? `No ${propertyLabel(field).toLowerCase()}`
    );
  }
  return entries
    .map(
      ([field, value]) =>
        `${propertyLabel(field)}: ${formatPropertyValue(value) ?? "None"}`,
    )
    .join(" · ");
}

function ViewTaskRow({
  row,
  properties,
  titleProperty,
  omittedProperties = [],
  occurrence,
  onOpen,
  onToggle,
}: {
  row: TaskViewRow;
  properties: TaskViewProperty[];
  titleProperty?: string;
  omittedProperties?: string[];
  occurrence?: TaskOccurrence;
  onOpen(task: Task): void;
  onToggle(task: Task): void;
}) {
  const details = viewPropertyDetails(row, properties, {
    identityProperty: titleProperty,
    omittedProperties,
    occurrence,
    suppressRoutineDefaults: true,
  });
  return (
    <TaskRow
      task={row.task}
      details={details}
      occurrence={occurrence}
      onOpen={onOpen}
      onToggle={onToggle}
    />
  );
}

function ViewIcon({ view }: { view: TaskView }) {
  const type = view.presentation?.type;
  const Icon =
    type === "tasknotes.projects"
      ? FolderKanban
      : type === "tasknotes.kanban"
        ? Columns3
        : type === "tasknotes.calendar" || type === "tasknotes.mini-calendar"
          ? CalendarDays
          : List;
  return <Icon aria-hidden="true" size={21} strokeWidth={1.55} />;
}

interface ViewProps {
  execution: TaskViewExecution;
  onOpen(task: Task, occurrenceDate?: string): void;
  onToggle(task: Task, occurrenceDate?: string): void;
}

function executionWithManualRanks(
  execution: TaskViewExecution,
  ranks: ReadonlyMap<
    string,
    { viewKey: string; sortOrder: string; operationId: number }
  >,
  viewKey: string,
  order: ManualOrderConfiguration,
  sortOrderField: string,
): TaskViewExecution {
  const rows = execution.rows.map((row) => {
    const rank = ranks.get(row.task.id);
    if (!rank || rank.viewKey !== viewKey) return row;
    return {
      ...row,
      task: {
        ...row.task,
        sortOrder: rank.sortOrder,
        frontmatter: {
          ...row.task.frontmatter,
          [sortOrderField]: rank.sortOrder,
        },
      },
    };
  });
  const rowByTask = new Map(rows.map((row) => [row.task.id, row]));
  return {
    ...execution,
    view: {
      ...execution.view,
      sort: execution.view.sort?.length ? execution.view.sort : [order],
    },
    rows: sortTasksByManualOrder(
      rows.map(({ task }) => task),
      order.direction,
    ).map((task) => rowByTask.get(task.id)!),
  };
}

function calendarGrid(month: Date): Date[] {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function weekdays(): string[] {
  const sunday = new Date(2024, 0, 7);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(sunday);
    day.setDate(sunday.getDate() + index);
    return new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(
      day,
    );
  });
}

function storageDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function agendaLabel(value: string): string {
  const date = dateFromStorage(value);
  return date
    ? new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(date)
    : value;
}

function valueKey(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function columnLabel(value: unknown): string {
  if (value === null || value === "") return "No value";
  return String(value).replaceAll("-", " ");
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

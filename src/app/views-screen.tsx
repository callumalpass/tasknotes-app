import { ChevronLeft, GripVertical, Pencil, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import { LoadingRows } from "../components/loading";
import { OperationErrorNotice } from "../components/operation-error-notice";
import { ViewExecutionErrorNotice } from "../components/view-execution-error-notice";
import { TaskCapture } from "../components/task-capture";
import { kanbanPropertyRole, type KanbanFieldMapping } from "../domain/kanban";
import { todayString } from "../domain/task";
import {
  appendManualOrderRank,
  disableManualOrderSort,
  enableManualOrderSort,
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
import {
  sectionTaskViewRows,
  taskListSectionMoveInput,
} from "../domain/task-list-sections";
import {
  viewGroupMoveInput,
  viewPropertyMoveInput,
} from "../domain/view-mutation";
import { formatPropertyValue, propertyLabel } from "../domain/view-values";
import { selectionFeedback } from "../native/feedback";
import {
  useRepository,
  useRepositoryRevision,
  useTasks,
} from "./repository-context";
import { ViewEditor } from "./view-editor";
import { preloadViewEditor } from "./view-editor-loader";
import { readViewDraft, updateViewDocument } from "../domain/view-document";
import { ViewTaskRow } from "./views/view-task-row";
import {
  calendarDateDefaults,
  calendarSelectionDefaults,
} from "../domain/mini-calendar";
import { ViewCatalog } from "./views/view-catalog";
import { ProjectsView } from "./views/projects-view";
import {
  removeConfirmedBoardMoves,
  removeConfirmedListMoves,
  removeConfirmedManualRanks,
  type OptimisticBoardMove,
  type OptimisticListMove,
  type OptimisticManualRank,
} from "./optimistic-view-reconciliation";
import { PlannerViewHandoff } from "./views/planner-view-handoff";
import { usePlannerViewLink } from "./use-planner-view-link";
import { CalendarViewPresentation } from "./views/calendar-view-presentation";
import { useCalendarMutations } from "./use-calendar-mutations";

import type { CreateTaskInput, Task, UpdateTaskInput } from "../domain/task";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { CalendarPreferences } from "./calendar-preferences";
import { defaultCalendarPreferences } from "./calendar-preferences";
import type {
  TaskView,
  TaskViewDocument,
  TaskViewExecution,
  TaskViewProperty,
  TaskViewRow,
} from "../domain/view";

type ViewExecutionFailure = { key: string; reason: unknown };
type ViewEditorRequest = {
  view?: TaskView;
  duplicate?: boolean;
  confirmDelete?: boolean;
};

export function ViewsScreen({
  calendarPreferences = defaultCalendarPreferences(),
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
  onOpenScratchpad = () => undefined,
  onToggleNavigationView,
  onMoveNavigationView,
  onViewsChanged,
}: {
  calendarPreferences?: CalendarPreferences;
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
  onOpenScratchpad?(): void;
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
    pendingDeletion,
  } = useRepository();
  const viewRevision = useRepositoryRevision(`view:${viewKey ?? "catalog"}`);
  const [execution, setExecution] = useState<TaskViewExecution | null>(null);
  const [executionError, setExecutionError] =
    useState<ViewExecutionFailure | null>(null);
  const [executionRetry, setExecutionRetry] = useState(0);
  const [refreshingExecution, setRefreshingExecution] = useState<string | null>(
    null,
  );
  const [editing, setEditing] = useState<ViewEditorRequest | null>(null);
  const [boardMoves, setBoardMoves] = useState<
    Map<string, OptimisticBoardMove>
  >(() => new Map());
  const [boardMovesPending, setBoardMovesPending] = useState<
    Map<string, { viewKey: string; sequence: number }>
  >(() => new Map());
  const [listMoves, setListMoves] = useState<Map<string, OptimisticListMove>>(
    () => new Map(),
  );
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
    defaults?: Partial<CreateTaskInput>;
    focusRequest?: number;
  } | null>(null);
  const [sourceSort, setSourceSort] = useState<{
    key: string;
    sort: NonNullable<TaskView["sort"]>;
  } | null>(null);
  const [manualRanks, setManualRanks] = useState<
    Map<string, OptimisticManualRank>
  >(() => new Map());
  const [manualOrderPending, setManualOrderPending] = useState<
    Map<number, { viewKey: string; taskId: string }>
  >(() => new Map());
  const [manualOrderSortPending, setManualOrderSortPending] = useState<
    string | null
  >(null);
  const viewMutationSequence = useRef(new Map<string, number>());
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
  const plannerHref = usePlannerViewLink(repository, selected);
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
  const calendarMutations = useCalendarMutations(
    selected,
    (refreshed) => {
      if (selectedKeyRef.current !== refreshed.view.key) return;
      setExecution(refreshed);
      setExecutionError(null);
    },
    (view, reason) => {
      if (selectedKeyRef.current === view.key)
        setExecutionError({ key: view.key, reason });
    },
  );
  const reconcileOptimisticExecution = useCallback(
    (nextExecution: TaskViewExecution, nextViewKey: string) => {
      const rows = new Map(
        nextExecution.rows.map((row) => [row.task.id, row] as const),
      );
      setManualRanks((ranks) =>
        removeConfirmedManualRanks(
          ranks,
          rows,
          nextViewKey,
          configuration.fieldMapping.sortOrder,
        ),
      );
      setBoardMoves((moves) =>
        removeConfirmedBoardMoves(moves, rows, nextViewKey),
      );
      setListMoves((moves) =>
        removeConfirmedListMoves(moves, rows, nextViewKey),
      );
    },
    [configuration.fieldMapping.sortOrder],
  );
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
        reconcileOptimisticExecution(result, selected.key);
        setExecutionError(null);
        setRefreshingExecution(null);
      },
      (reason) => {
        if (!active) return;
        refreshed = true;
        setExecutionError({ key: selected.key, reason });
        setRefreshingExecution(null);
      },
    );
    return () => {
      active = false;
    };
  }, [
    reconcileOptimisticExecution,
    repository,
    selected,
    viewKey,
    viewRevision,
    executionRetry,
  ]);
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
  const selectedManualOrderOperations = [...manualOrderPending.values()].filter(
    ({ viewKey: pendingViewKey }) => pendingViewKey === selected?.key,
  );
  const manualOrderPendingForSelected =
    selectedManualOrderOperations.length > 0;
  const manualOrderPendingTaskIds = new Set(
    selectedManualOrderOperations.map(({ taskId }) => taskId),
  );
  const presentedExecution = useMemo(() => {
    const ranked =
      visibleExecution && manualOrder
        ? executionWithManualRanks(
            visibleExecution,
            manualRanks,
            selected?.key ?? "",
            manualOrder,
            configuration.fieldMapping.sortOrder,
          )
        : visibleExecution;
    return ranked && pendingDeletion
      ? executionWithoutTask(ranked, pendingDeletion.id)
      : ranked;
  }, [
    configuration.fieldMapping.sortOrder,
    manualOrder,
    manualRanks,
    pendingDeletion,
    selected?.key,
    visibleExecution,
  ]);
  const currentExecutionRefreshing =
    refreshingExecution ===
    (selected ? `${selected.key}:${selected.source.revision}` : null);
  const error =
    executionError?.key === selected?.key ? executionError?.reason : viewsError;
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
  const calendarRangeDefaults =
    calendarSelection && calendarSelection.key === selected?.key
      ? (calendarSelection.defaults ?? {})
      : {};
  const manualCreateRank =
    manualOrder && presentedExecution
      ? appendManualOrderRank(
          presentedExecution.rows.map(({ task }) => task),
          manualOrder.direction,
        )
      : undefined;
  const captureDefaults =
    selected?.presentation?.type === "tasknotes.planner" ||
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
                mergeTaskCreationDefaults(
                  calendarRangeDefaults,
                  currentCreationContext?.defaults ?? {},
                ),
              ),
            )
          : null;
  const presentationClass =
    selected?.presentation?.type === "tasknotes.task-list" ||
    selected?.presentation?.type === "tasknotes.planner"
      ? " is-task-list-view"
      : selected?.presentation?.type === "tasknotes.kanban"
        ? " is-kanban-view"
        : selected?.presentation?.type === "tasknotes.calendar"
          ? " is-full-calendar-view"
          : selected?.presentation?.type === "tasknotes.mini-calendar"
            ? " is-mini-calendar-view"
            : "";

  async function toggleManualOrderSort() {
    if (!selected || !selected.source.writable || manualOrderSortPending)
      return;
    const view = selected;
    const sortOrderField = configuration.fieldMapping.sortOrder;
    setManualOrderSortPending(view.key);
    setViewActionError(null);
    try {
      const source = await repository.readViewSource(view.source.path);
      const draft = readViewDraft(source, view.id);
      const active = Boolean(
        manualOrderConfiguration(draft.sort, sortOrderField),
      );
      const defaultProperty =
        draft.dialect === "obsidian-bases"
          ? basesProperty(sortOrderField)
          : sortOrderField;
      const sort = active
        ? disableManualOrderSort(draft.sort, sortOrderField)
        : enableManualOrderSort(draft.sort, sortOrderField, defaultProperty);
      await repository.updateViewSource({
        path: source.path,
        ifRevision: source.revision,
        document: updateViewDocument(source, { ...draft, sort }),
      });
      setSourceSort({ key: view.key, sort });
      void onViewsChanged().catch(() => undefined);
    } catch (reason) {
      setViewActionError({ viewKey: view.key, message: message(reason) });
    } finally {
      setManualOrderSortPending((key) => (key === view.key ? null : key));
    }
  }

  async function reorderTasks(
    rows: readonly TaskViewRow[],
    dragged: TaskViewRow,
    targetId: string | undefined,
    placement: ManualOrderPlacement,
    additionalInput: UpdateTaskInput = {},
  ): Promise<boolean> {
    if (!selected || !manualOrder) return false;
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
    if (!plan.writes.length && !Object.keys(additionalInput).length)
      return true;
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
          reconcileOptimisticExecution(refreshed, view.key);
        }
        return true;
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
            .catch(() => undefined);
        }
        setManualRanks((current) => {
          const next = new Map(current);
          for (const write of plan.writes) {
            if (next.get(write.taskId)?.operationId === operationId)
              next.delete(write.taskId);
          }
          return next;
        });
        return false;
      } finally {
        setManualOrderPending((pending) => {
          if (!pending.has(operationId)) return pending;
          const next = new Map(pending);
          next.delete(operationId);
          return next;
        });
      }
    });
    manualOrderMutationQueue.current = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
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
      ? viewPropertyMoveInput({
          task: row.task,
          property,
          sourceValue: current,
          destinationValue: value,
          preserveOtherListValues: true,
          configuration,
        })
      : {};
    if (!input) {
      setViewActionError({
        viewKey: selected.key,
        message: `${propertyLabel(property)} is calculated by this view and cannot be changed here.`,
      });
      return;
    }
    const sequence = (viewMutationSequence.current.get(row.task.id) ?? 0) + 1;
    viewMutationSequence.current.set(row.task.id, sequence);

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
      const saved = await reorderTasks(
        order.rows,
        row,
        order.targetId,
        order.placement,
        changesColumn ? input : {},
      );
      if (!saved) clearBoardMove(row.task.id, sequence);
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
    setBoardMovesPending((pending) => {
      const next = new Map(pending);
      next.set(row.task.id, { viewKey: selected.key, sequence });
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
      if (viewMutationSequence.current.get(row.task.id) !== sequence) return;
      clearBoardMove(row.task.id, sequence);
      clearBoardMovePending(row.task.id, sequence);
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

    if (viewMutationSequence.current.get(row.task.id) !== sequence) return;
    try {
      const refreshed = await repository.executeView(selected);
      if (viewMutationSequence.current.get(row.task.id) !== sequence) return;
      if (selectedKeyRef.current !== selected.key) return;
      setExecution(refreshed);
      setExecutionError(null);
      reconcileOptimisticExecution(refreshed, selected.key);
    } catch (reason) {
      if (viewMutationSequence.current.get(row.task.id) !== sequence) return;
      if (selectedKeyRef.current === selected.key)
        setViewActionError({
          viewKey: selected.key,
          message: `The move was saved, but this view could not refresh. ${message(reason)}`,
        });
    } finally {
      clearBoardMovePending(row.task.id, sequence);
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

  function clearBoardMovePending(taskId: string, sequence: number) {
    setBoardMovesPending((pending) => {
      if (pending.get(taskId)?.sequence !== sequence) return pending;
      const next = new Map(pending);
      next.delete(taskId);
      return next;
    });
  }

  async function moveListTask(
    row: TaskViewRow,
    source: TaskListLane,
    destination: TaskListLane,
    targetId: string | undefined,
    placement: ManualOrderPlacement,
  ) {
    if (!selected || !manualOrder) return;
    const changesLane = source.key !== destination.key;
    const input = changesLane
      ? taskListLaneMoveInput(row.task, source, destination, configuration)
      : {};
    if (!input) {
      setViewActionError({
        viewKey: selected.key,
        message: `“${destination.label ?? "This section"}” is calculated and cannot accept moved tasks.`,
      });
      return;
    }

    const sequence = (viewMutationSequence.current.get(row.task.id) ?? 0) + 1;
    viewMutationSequence.current.set(row.task.id, sequence);
    if (changesLane)
      setListMoves((moves) => {
        const next = new Map(moves);
        next.set(row.task.id, {
          viewKey: selected.key,
          laneKey: destination.key,
          input,
          sequence,
        });
        return next;
      });
    const saved = await reorderTasks(
      destination.rows,
      row,
      targetId,
      placement,
      changesLane ? input : {},
    );
    if (!saved)
      setListMoves((moves) => {
        const move = moves.get(row.task.id);
        if (!move || move.sequence !== sequence) return moves;
        const next = new Map(moves);
        next.delete(row.task.id);
        return next;
      });
  }

  async function refreshAfterCreate(task: Task) {
    if (!selected) return;
    const refreshed = await repository.executeView(selected);
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
              <h1 id="views-title">Manage views</h1>
              <p>
                Choose what appears in navigation, change its order, and manage
                saved views.
              </p>
            </div>
            <div className="views-header-actions">
              <button
                className="text-action views-create-action"
                type="button"
                onFocus={preloadViewEditor}
                onClick={() => setEditing({})}
                onPointerEnter={preloadViewEditor}
              >
                <Plus aria-hidden="true" size={20} strokeWidth={1.7} />
                Create view
              </button>
            </div>
          </header>
          {viewsError ? (
            <OperationErrorNotice
              action="Views"
              message={viewsError}
              recovery="Retry by reopening Manage views or refreshing the collection."
            />
          ) : null}
          {!documents || !views ? (
            <LoadingRows count={4} />
          ) : (
            <ViewCatalog
              documents={documents}
              navigationViewKeys={navigationViewKeys}
              views={views}
              onDelete={(view) => setEditing({ view, confirmDelete: true })}
              onDuplicate={(view) => setEditing({ view, duplicate: true })}
              onEdit={(view) => setEditing({ view })}
              onMoveNavigation={onMoveNavigationView}
              onOpenScratchpad={onOpenScratchpad}
              onOpenSearch={onSearch}
              onOpenView={onOpenView}
              onToggleNavigation={onToggleNavigationView}
            />
          )}
        </section>
        {editing ? (
          <ViewEditor
            confirmDelete={editing.confirmDelete}
            duplicate={editing.duplicate}
            view={editing.view}
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
            {visibleExecution && currentExecutionRefreshing ? (
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
          {!editing && (selected?.source.writable || operational) ? (
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
              {selected?.source.writable ? (
                <button
                  aria-label={
                    manualOrder
                      ? "Turn off manual order"
                      : "Turn on manual order"
                  }
                  aria-pressed={Boolean(manualOrder)}
                  className="view-header-action"
                  disabled={manualOrderSortPending === selected.key}
                  title={
                    manualOrder
                      ? "Turn off manual order"
                      : "Turn on manual order"
                  }
                  type="button"
                  onClick={() => void toggleManualOrderSort()}
                >
                  <GripVertical aria-hidden="true" size={18} />
                </button>
              ) : null}
              {selected?.source.writable ? (
                <button
                  aria-label={`Edit ${selected.name}`}
                  className="edit-view-action"
                  title={`Edit ${selected.name}`}
                  type="button"
                  onFocus={preloadViewEditor}
                  onClick={() => setEditing({ view: selected })}
                  onPointerEnter={preloadViewEditor}
                >
                  <Pencil aria-hidden="true" size={18} />
                </button>
              ) : null}
            </div>
          ) : null}
        </header>
        {error ? (
          <ViewExecutionErrorNotice
            canEdit={Boolean(selected?.source.writable)}
            reason={error}
            onEdit={() => selected && setEditing({ view: selected })}
            onRetry={() => setExecutionRetry((attempt) => attempt + 1)}
          />
        ) : null}
        {!error && presentedExecution?.hasSkippedRecords ? (
          <p className="view-record-warning" role="status">
            Some files could not be read and were omitted from this view.
          </p>
        ) : null}
        {currentViewActionError ? (
          <OperationErrorNotice
            action="The view change"
            message={currentViewActionError}
            recovery="Nothing else changed. Try again."
          />
        ) : null}
        {editing ? (
          <ViewEditor
            confirmDelete={editing.confirmDelete}
            duplicate={editing.duplicate}
            view={editing.view}
            onClose={() => setEditing(null)}
            onChanged={onViewsChanged}
          />
        ) : null}
        {plannerHref ? (
          <PlannerViewHandoff
            href={plannerHref}
            taskCount={presentedExecution?.totalCount}
          />
        ) : null}
        {captureDefaults ? (
          <TaskCapture
            key={selected?.key}
            configuration={configuration}
            createTask={createTask}
            completeField={completeField}
            defaults={captureDefaults}
            focusRequest={
              currentCreationContext?.focusRequest ??
              (calendarSelection && calendarSelection.key === selected?.key
                ? calendarSelection.focusRequest
                : undefined)
            }
            retainFocusAfterCreate
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
            pendingMoveTaskIds={
              new Set(
                [...boardMovesPending]
                  .filter(([, move]) => move.viewKey === selected?.key)
                  .map(([taskId]) => taskId),
              )
            }
            statusColumns={[...configuration.statuses]
              .sort((left, right) => left.order - right.order)
              .map(({ value, label, color }) => ({ value, label, color }))}
            priorityColumns={[...configuration.priorities]
              .sort((left, right) => left.weight - right.weight)
              .map(({ value, label, color }) => ({ value, label, color }))}
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
            "tasknotes.calendar" ||
          presentedExecution.view.presentation?.type ===
            "tasknotes.mini-calendar" ? (
          <CalendarViewPresentation
            key={`${presentedExecution.view.key}:${presentedExecution.view.source.revision}`}
            execution={presentedExecution}
            preferences={calendarPreferences}
            identityTasks={identityTasks}
            selected={currentCalendarSelection}
            selectedCreateValue={currentCalendarCreateValue}
            titleProperty={configuration.fieldMapping.title}
            onSelect={(date, createValue = date) =>
              selected &&
              setCalendarSelection({
                key: selected.key,
                date,
                createValue,
              })
            }
            onCreate={(date, createValue = date, timeEstimate) =>
              selected &&
              setCalendarSelection({
                key: selected.key,
                date,
                createValue,
                defaults: calendarSelectionDefaults(
                  selected,
                  createValue,
                  timeEstimate,
                ),
                focusRequest: Date.now(),
              })
            }
            onOpen={onOpenTask}
            onToggle={(task, occurrenceDate) =>
              void toggleTask(task.id, occurrenceDate)
            }
            onUpdate={calendarMutations.updateTask}
            onUpdateOccurrence={calendarMutations.updateOccurrence}
            onReplaceTimeEntries={calendarMutations.replaceTimeEntries}
          />
        ) : (
          <TaskListView
            configuration={configuration}
            execution={presentedExecution}
            moves={
              new Map(
                [...listMoves].filter(
                  ([, move]) => move.viewKey === selected?.key,
                ),
              )
            }
            manualOrder={manualOrder}
            orderPending={manualOrderPendingForSelected}
            titleProperty={configuration.fieldMapping.title}
            onMove={(dragged, source, destination, targetId, placement) =>
              void moveListTask(
                dragged,
                source,
                destination,
                targetId,
                placement,
              )
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

function KanbanView({
  execution,
  fieldMapping,
  manualOrder,
  orderPending,
  orderPendingTaskIds,
  moves,
  pendingMoveTaskIds,
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
  pendingMoveTaskIds: ReadonlySet<string>;
  moves: Map<
    string,
    {
      viewKey: string;
      property: string;
      value: unknown;
      sequence: number;
    }
  >;
  priorityColumns: Array<{ value: string; label: string; color?: string }>;
  statusColumns: Array<{ value: string; label: string; color?: string }>;
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
    {
      value: unknown;
      label?: string;
      color?: string;
      rows: typeof execution.rows;
    }
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
      color: configured.color,
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
    const previousTop = board.scrollTop;
    if (horizontalDistance) board.scrollLeft += horizontalDistance;
    if (verticalDistance) board.scrollTop += verticalDistance;
    const drop = dropAt(pointer.x, pointer.y);
    updateDropFeedback(drop);
    if (board.scrollLeft !== previousLeft || board.scrollTop !== previousTop)
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
        aria-busy={orderPending || pendingMoveTaskIds.size > 0}
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
              <header
                style={
                  propertyName === "status" && column.color
                    ? { borderBottomColor: column.color }
                    : undefined
                }
              >
                <h2
                  style={
                    propertyName === "priority" && column.color
                      ? { color: column.color }
                      : undefined
                  }
                >
                  {label}
                </h2>
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
                    pendingMoveTaskIds.has(row.task.id) ||
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

type TaskListLaneMutation =
  | { type: "group"; values: Record<string, unknown> }
  | { type: "section"; mode: unknown; section: string };

interface TaskListLane {
  key: string;
  label?: string;
  className?: string;
  rows: TaskViewRow[];
  mutation?: TaskListLaneMutation;
}

function TaskListView({
  configuration,
  execution,
  moves,
  manualOrder,
  orderPending,
  titleProperty,
  onMove,
  onOpen,
  onToggle,
}: ViewProps & {
  configuration: TaskCollectionConfiguration;
  moves: ReadonlyMap<string, { laneKey: string }>;
  manualOrder: ManualOrderConfiguration | null;
  orderPending: boolean;
  titleProperty: string;
  onMove(
    dragged: TaskViewRow,
    source: TaskListLane,
    destination: TaskListLane,
    targetId: string | undefined,
    placement: ManualOrderPlacement,
  ): void;
}) {
  if (!execution.rows.length)
    return (
      <div className="plain-empty task-list-view">
        <h2>No tasks match this view</h2>
        <p>
          {execution.view.presentation?.options.create === false
            ? "Adjust this view’s filters or choose another view."
            : "Add a task above, or adjust this view’s filters."}
        </p>
      </div>
    );
  const groups = groupTaskViewRows(execution);
  let lanes: TaskListLane[];
  let grouped = false;
  let daySections = false;
  if (groups.length) {
    grouped = true;
    lanes = groups.map((group) => ({
      key: `group:${group.key}`,
      label: Object.keys(group.values).length
        ? groupLabel(Object.entries(group.values))
        : "Other",
      rows: group.rows,
      mutation: { type: "group", values: group.values },
    }));
  } else {
    const sectionMode = execution.view.presentation?.options.sections;
    const sections = sectionTaskViewRows(
      execution.rows,
      sectionMode,
      todayString(),
      { includeEmpty: Boolean(manualOrder) || moves.size > 0 },
    );
    if (sections.length) {
      grouped = true;
      daySections = sectionMode === "day";
      lanes = sections.map((section) => ({
        key: `section:${section.key}`,
        label: section.label,
        className: `is-${section.key}`,
        rows: section.rows,
        mutation: {
          type: "section",
          mode: sectionMode,
          section: section.key,
        },
      }));
    } else {
      lanes = [{ key: "flat", rows: execution.rows }];
    }
  }
  lanes = applyOptimisticListMoves(lanes, execution.rows, moves, manualOrder);
  return (
    <ManualTaskRows
      configuration={configuration}
      daySections={daySections}
      grouped={grouped}
      lanes={lanes}
      manualOrder={manualOrder}
      orderPending={orderPending}
      properties={execution.view.properties}
      titleProperty={titleProperty}
      onOpen={onOpen}
      onMove={onMove}
      onToggle={onToggle}
    />
  );
}

function ManualTaskRows({
  configuration,
  daySections,
  grouped,
  lanes,
  manualOrder,
  orderPending,
  properties,
  titleProperty,
  onOpen,
  onMove,
  onToggle,
}: {
  configuration: TaskCollectionConfiguration;
  daySections: boolean;
  grouped: boolean;
  lanes: TaskListLane[];
  manualOrder: ManualOrderConfiguration | null;
  orderPending: boolean;
  properties: TaskViewProperty[];
  titleProperty: string;
  onOpen(task: Task, occurrenceDate?: string): void;
  onMove(
    dragged: TaskViewRow,
    source: TaskListLane,
    destination: TaskListLane,
    targetId: string | undefined,
    placement: ManualOrderPlacement,
  ): void;
  onToggle(task: Task, occurrenceDate?: string): void;
}) {
  const [dragging, setDragging] = useState<{
    taskId: string;
    sourceLaneKey: string;
  } | null>(null);
  const draggingRef = useRef<typeof dragging>(null);
  const [drop, setDrop] = useState<{
    laneKey: string;
    targetId?: string;
    placement: ManualOrderPlacement;
  } | null>(null);
  const dropRef = useRef(drop);
  const listRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const rowById = new Map(
    lanes.flatMap((lane) =>
      lane.rows.map((row) => [row.task.id, row] as const),
    ),
  );
  const laneByKey = new Map(lanes.map((lane) => [lane.key, lane]));
  const firstTask = lanes.flatMap((lane) => lane.rows)[0]?.task;
  const canMoveAcrossLanes = Boolean(
    firstTask &&
    lanes.some(
      (lane) =>
        lane.mutation &&
        taskListLaneMoveInput(firstTask, lane, lane, configuration) !== null,
    ),
  );

  function clearDrag() {
    draggingRef.current = null;
    dropRef.current = null;
    setDragging(null);
    setDrop(null);
  }

  function updateDrop(clientX: number, clientY: number) {
    const root = listRef.current;
    const element = document.elementFromPoint(clientX, clientY);
    const laneElement = element?.closest<HTMLElement>("[data-list-lane]");
    if (!root || !laneElement || !root.contains(laneElement)) {
      dropRef.current = null;
      setDrop(null);
      return;
    }
    const laneKey = laneElement.dataset.listLane;
    if (!laneKey) return;
    const target = element?.closest<HTMLElement>("[data-manual-order-task]");
    const targetId = target?.dataset.manualOrderTask;
    if (targetId && targetId === draggingRef.current?.taskId) {
      dropRef.current = null;
      setDrop(null);
      return;
    }
    const bounds = target?.getBoundingClientRect();
    const next = {
      laneKey,
      ...(targetId ? { targetId } : {}),
      placement:
        bounds && clientY < bounds.top + bounds.height / 2
          ? ("before" as const)
          : ("after" as const),
    };
    dropRef.current = next;
    setDrop(next);
  }

  function finish(row: TaskViewRow) {
    const active = draggingRef.current;
    const destination = dropRef.current;
    clearDrag();
    if (!active || !destination) return;
    const sourceLane = laneByKey.get(active.sourceLaneKey);
    const destinationLane = laneByKey.get(destination.laneKey);
    if (!sourceLane || !destinationLane) return;
    const input =
      sourceLane.key === destinationLane.key
        ? {}
        : taskListLaneMoveInput(
            row.task,
            sourceLane,
            destinationLane,
            configuration,
          );
    if (!input) {
      setAnnouncement(
        `${destinationLane.label ?? "That section"} is read-only.`,
      );
      return;
    }
    onMove(
      row,
      sourceLane,
      destinationLane,
      destination.targetId,
      destination.placement,
    );
    const target = destination.targetId
      ? rowById.get(destination.targetId)?.task
      : undefined;
    setAnnouncement(
      sourceLane.key !== destinationLane.key
        ? `Moved ${row.task.title} to ${destinationLane.label ?? "the destination section"}.`
        : target
          ? `Moved ${row.task.title} ${destination.placement} ${target.title}.`
          : `Moved ${row.task.title}.`,
    );
  }

  function moveWithKeyboard(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    row: TaskViewRow,
    sourceLane: TaskListLane,
  ) {
    const direction =
      event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!direction) return;
    const laneIndex = lanes.findIndex((lane) => lane.key === sourceLane.key);
    const rowIndex = sourceLane.rows.findIndex(
      (candidate) => candidate.task.id === row.task.id,
    );
    const adjacent = sourceLane.rows[rowIndex + direction];
    const destinationLane = adjacent
      ? sourceLane
      : lanes[laneIndex + direction];
    if (!destinationLane) return;
    const target = adjacent
      ? adjacent
      : direction < 0
        ? destinationLane.rows.at(-1)
        : destinationLane.rows[0];
    const input =
      sourceLane.key === destinationLane.key
        ? {}
        : taskListLaneMoveInput(
            row.task,
            sourceLane,
            destinationLane,
            configuration,
          );
    if (!input) return;
    event.preventDefault();
    const crossesLane = sourceLane.key !== destinationLane.key;
    onMove(
      row,
      sourceLane,
      destinationLane,
      target?.task.id,
      crossesLane
        ? direction < 0
          ? "after"
          : "before"
        : direction < 0
          ? "before"
          : "after",
    );
    setAnnouncement(
      crossesLane
        ? `Moved ${row.task.title} to ${destinationLane.label ?? "the destination section"}.`
        : `Moved ${row.task.title} ${direction < 0 ? "up" : "down"}.`,
    );
  }

  return (
    <>
      <div
        aria-busy={orderPending}
        className={
          grouped
            ? `task-groups saved-view-groups task-list-view${daySections ? " day-task-sections" : ""}`
            : `saved-task-list task-list-view${manualOrder ? " manual-order-list" : ""}`
        }
        ref={listRef}
      >
        {lanes.map((lane) => {
          const rows = (
            <div
              className={`saved-task-list${grouped && manualOrder ? " manual-order-list" : ""}`}
            >
              {lane.rows.map((row) => (
                <div
                  className={`manual-order-row${dragging?.taskId === row.task.id ? " is-dragging" : ""}${drop?.targetId === row.task.id ? ` is-drop-${drop.placement}` : ""}`}
                  data-manual-order-task={row.task.id}
                  key={row.task.id}
                >
                  {manualOrder ? (
                    <button
                      aria-label={`Reorder ${row.task.title}. Drag, or use up and down arrow keys.`}
                      className="manual-order-handle"
                      disabled={orderPending}
                      type="button"
                      onKeyDown={(event) => moveWithKeyboard(event, row, lane)}
                      onPointerDown={(event) => {
                        if (orderPending) return;
                        event.preventDefault();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        const active = {
                          taskId: row.task.id,
                          sourceLaneKey: lane.key,
                        };
                        draggingRef.current = active;
                        setDragging(active);
                        setAnnouncement(`Moving ${row.task.title}.`);
                      }}
                      onPointerMove={(event) => {
                        if (draggingRef.current?.taskId !== row.task.id) return;
                        event.preventDefault();
                        updateDrop(event.clientX, event.clientY);
                      }}
                      onPointerCancel={clearDrag}
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
              {grouped && manualOrder && !lane.rows.length ? (
                <div className="task-list-empty-drop-zone">Drop here</div>
              ) : null}
            </div>
          );
          if (!grouped)
            return (
              <div data-list-lane={lane.key} key={lane.key}>
                {rows}
              </div>
            );
          return (
            <section
              className={`task-section${lane.className ? ` ${lane.className}` : ""}${drop?.laneKey === lane.key ? " is-drop-target" : ""}`}
              data-list-lane={lane.key}
              key={lane.key}
            >
              <div className="section-heading">
                <h2>{lane.label}</h2>
                <span>{lane.rows.length}</span>
              </div>
              {rows}
            </section>
          );
        })}
      </div>
      {manualOrder && grouped && !canMoveAcrossLanes ? (
        <p className="view-note">
          These sections are calculated, so tasks can only be reordered within
          them.
        </p>
      ) : null}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}

function taskListLaneMoveInput(
  task: Task,
  source: TaskListLane,
  destination: TaskListLane,
  configuration: TaskCollectionConfiguration,
): UpdateTaskInput | null {
  if (destination.mutation?.type === "group") {
    if (source.mutation?.type !== "group") return null;
    return viewGroupMoveInput(
      task,
      source.mutation.values,
      destination.mutation.values,
      configuration,
    );
  }
  if (destination.mutation?.type === "section")
    return taskListSectionMoveInput(
      task,
      destination.mutation.mode,
      destination.mutation.section,
    );
  return null;
}

function applyOptimisticListMoves(
  lanes: readonly TaskListLane[],
  rows: readonly TaskViewRow[],
  moves: ReadonlyMap<string, { laneKey: string }>,
  manualOrder: ManualOrderConfiguration | null,
): TaskListLane[] {
  if (!moves.size) return lanes.map((lane) => ({ ...lane }));
  const rowById = new Map(rows.map((row) => [row.task.id, row]));
  const movedIds = new Set(moves.keys());
  return lanes.map((lane) => {
    const movedHere = [...moves]
      .filter(([, move]) => move.laneKey === lane.key)
      .flatMap(([taskId]) => {
        const row = rowById.get(taskId);
        return row ? [row] : [];
      });
    const nextRows = [
      ...lane.rows.filter((row) => !movedIds.has(row.task.id)),
      ...movedHere,
    ];
    if (!manualOrder) return { ...lane, rows: nextRows };
    const byId = new Map(nextRows.map((row) => [row.task.id, row]));
    return {
      ...lane,
      rows: sortTasksByManualOrder(
        nextRows.map((row) => row.task),
        manualOrder.direction,
      ).map((task) => byId.get(task.id)!),
    };
  });
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

interface ViewProps {
  execution: TaskViewExecution;
  onOpen(task: Task, occurrenceDate?: string): void;
  onToggle(task: Task, occurrenceDate?: string): void;
}

function executionWithManualRanks(
  execution: TaskViewExecution,
  ranks: ReadonlyMap<string, OptimisticManualRank>,
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

function valueKey(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function columnLabel(value: unknown): string {
  if (value === null || value === "") return "No value";
  return String(value).replaceAll("-", " ");
}

function basesProperty(field: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(field)
    ? `note.${field}`
    : `note[${JSON.stringify(field)}]`;
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function executionWithoutTask(
  execution: TaskViewExecution,
  taskId: string,
): TaskViewExecution {
  const removedPath = execution.rows.find((row) => row.task.id === taskId)?.task
    .path;
  const rows = execution.rows.filter((row) => row.task.id !== taskId);
  if (rows.length === execution.rows.length) return execution;
  return {
    ...execution,
    rows,
    records: removedPath
      ? execution.records?.filter(({ record }) => record.path !== removedPath)
      : execution.records,
    totalCount: Math.max(0, execution.totalCount - 1),
  };
}

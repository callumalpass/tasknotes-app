import {
  Check,
  ChevronLeft,
  GripVertical,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { captureSessionFor } from "../application/capture-session";
import { GlobalTaskCapture } from "../components/global-task-capture";
import { ViewOptions } from "../components/view-options";
import { ViewQuerySession } from "../application/view-query-session";
import { canReorderExecution } from "./manual-order-availability";
import { ArrangeTasksOption } from "../components/arrange-tasks-option";
import { basesProperty } from "../domain/default-view-source";
import { ProjectPropertyOffer } from "./views/project-property-offer";
import { valueKey } from "./views/kanban-columns";
import { navigationViewScope } from "./navigation-views";
import { LoadingRows } from "../components/loading";
import { OperationErrorNotice } from "../components/operation-error-notice";
import { ViewExecutionErrorNotice } from "../components/view-execution-error-notice";
import { taskCompletion } from "../domain/task-completion";
import { TaskCapture } from "../components/task-capture";
import { todayString } from "../domain/task";
import {
  appendManualOrderRank,
  disableManualOrderSort,
  enableManualOrderSort,
  manualOrderConfiguration,
  planManualOrder,
  type ManualOrderPlacement,
} from "../domain/manual-order";
import {
  createPlanForView,
  mergeTaskCreationDefaults,
  propertiesToCreateDefaults,
  type ViewCreationPlan,
} from "../domain/view-creation";
import { viewPropertyMoveInput } from "../domain/view-mutation";
import { propertyLabel } from "../domain/view-values";
import { selectionFeedback } from "../native/feedback";
import {
  useRepository,
  useRepositoryRevision,
  useTasks,
} from "./repository-context";
import { ViewEditor } from "./view-editor";
import { preloadViewEditor } from "./view-editor-loader";
import { readViewDraft, updateViewDocument } from "../domain/view-document";
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
  executionWithManualRanks,
  executionWithoutTask,
  taskListLaneMoveInput,
  type TaskListLane,
  type OptimisticBoardMove,
  type OptimisticListMove,
  type OptimisticManualRank,
} from "./optimistic-view-reconciliation";
import { PlannerViewHandoff } from "./views/planner-view-handoff";
import { usePlannerViewLink } from "./use-planner-view-link";
import { CalendarViewPresentation } from "./views/calendar-view-presentation";
import { useCalendarMutations } from "./use-calendar-mutations";
import type {
  CreateTaskInput,
  TaskSummary,
  UpdateTaskInput,
} from "../domain/task";
import type { CalendarPreferences } from "./calendar-preferences";
import { defaultCalendarPreferences } from "./calendar-preferences";
import type {
  TaskView,
  TaskViewDocument,
  TaskViewExecution,
  TaskViewRow,
} from "../domain/view";
import { KanbanView } from "./views/kanban-view";
import { TaskListView } from "./views/task-list-view";

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
  onTaskAdded,
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
  onOpenTask(task: TaskSummary, occurrenceDate?: string): void;
  onTaskAdded?(task: TaskSummary): void;
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
    setTaskCompletion,
    updateTask,
    updateTasks,
    configuration,
    pendingDeletion,
  } = useRepository();
  const toggleRow = (task: TaskSummary, occurrenceDate?: string) =>
    setTaskCompletion({
      id: task.id,
      occurrenceDate,
      completed: !taskCompletion(task, occurrenceDate),
    });
  const viewQueryRef = useRef<ViewQuerySession | null>(null);
  const queryRowsRef = useRef(new Map<string, number>());
  const [paging, setPaging] = useState({
    key: "",
    available: false,
    used: false,
  });
  const viewRevision = useRepositoryRevision(`view:${viewKey ?? "catalog"}`);
  const [execution, setExecution] = useState<TaskViewExecution | null>(null);
  const [executionError, setExecutionError] =
    useState<ViewExecutionFailure | null>(null);
  const [executionRetry, setExecutionRetry] = useState(0);
  const [refreshingExecution, setRefreshingExecution] = useState<string | null>(
    null,
  );
  const [editing, setEditing] = useState<ViewEditorRequest | null>(null);
  const [arrangingViewKey, setArrangingViewKey] = useState<string>();
  const [mobileCaptureOpen, setMobileCaptureOpen] = useState(false);
  const closeMobileCapture = useCallback(() => setMobileCaptureOpen(false), []);
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
  const [sectionScope, setSectionScope] = useState<string>();
  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => repository.collectionInfo())
      .then((info) => {
        if (active) setSectionScope(navigationViewScope(info));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [repository]);
  const hasWritableViews = views?.some((view) => view.source.writable) ?? false;
  useEffect(() => {
    if (!hasWritableViews) return;
    const timeout = window.setTimeout(preloadViewEditor, 400);
    return () => window.clearTimeout(timeout);
  }, [hasWritableViews]);

  const selected = views?.find((view) => view.key === viewKey);
  const captureSession = captureSessionFor(
    repository,
    `view:${viewKey ?? "catalog"}`,
  );
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
    const executionKey = `${selected.key}:${selected.source.revision}`;
    const session = new ViewQuerySession(
      repository,
      selected,
      {
        result: (result) => {
          setExecution(result);
          if (!result.stale) {
            if (queryRowsRef.current.get(selected.key) !== Infinity)
              queryRowsRef.current.set(selected.key, result.rows.length);
            reconcileOptimisticExecution(result, selected.key);
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
    viewQueryRef.current = session;
    void session.start();
    return () => {
      if (viewQueryRef.current === session) viewQueryRef.current = null;
      session.close();
    };
  }, [
    configuration.fieldMapping.sortOrder,
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
    void (
      viewQueryRef.current?.readSource() ??
      repository.readViewSource(selected.source.path)
    )
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
  const manualOrderPendingTaskIds = new Set(
    selectedManualOrderOperations.map(({ taskId }) => taskId),
  );
  const manualOrderPendingForSelected = manualOrderPendingTaskIds.size > 0;
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
  const orderUnavailable =
    Boolean(error) ||
    currentExecutionRefreshing ||
    !canReorderExecution(presentedExecution);
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
    manualOrder && presentedExecution && !presentedExecution.hasMore
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

  async function setManualOrderSort(enabled: boolean) {
    if (!selected || !selected.source.writable || manualOrderSortPending)
      return false;
    const view = selected;
    const sortOrderField = configuration.fieldMapping.sortOrder;
    setManualOrderSortPending(view.key);
    setViewActionError(null);
    try {
      const source = await repository.readViewSource(view.source.path);
      const draft = readViewDraft(source, view.id);
      const defaultProperty =
        draft.dialect === "obsidian-bases"
          ? basesProperty(sortOrderField)
          : sortOrderField;
      const sort = enabled
        ? enableManualOrderSort(draft.sort, sortOrderField, defaultProperty)
        : disableManualOrderSort(draft.sort, sortOrderField);
      await repository.updateViewSource({
        path: source.path,
        ifRevision: source.revision,
        document: updateViewDocument(source, { ...draft, sort }),
      });
      setSourceSort({ key: view.key, sort });
      void onViewsChanged().catch(() => undefined);
      return true;
    } catch (reason) {
      setViewActionError({ viewKey: view.key, message: message(reason) });
      return false;
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
    if (!selected || !manualOrder || orderUnavailable) return false;
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

  async function createTaskForView(input: CreateTaskInput) {
    if (selected && manualOrder && presentedExecution?.hasMore) {
      const complete = await repository.executeView(selected);
      if (complete.stale || complete.hasMore || complete.hasSkippedRecords)
        throw new Error(
          "The complete manual order could not be loaded. Your draft is kept; try again.",
        );
      return createTask({
        ...input,
        sortOrder: appendManualOrderRank(
          complete.rows.map((row) => row.task),
          manualOrder.direction,
        ),
      });
    }
    return createTask(input);
  }

  async function refreshAfterCreate(task: TaskSummary) {
    if (!selected) return;
    const session = viewQueryRef.current;
    const draftVersion = captureSession.getSnapshot().version;
    await session?.start();
    const refreshed = session?.currentResult;
    if (
      selectedKeyRef.current === selected.key &&
      captureSession.getSnapshot().version === draftVersion
    )
      setCreationContext(null);
    if (!refreshed) return;
    return refreshed.rows.some((row) => row.task.id === task.id)
      ? undefined
      : {
          message: refreshed.hasMore
            ? "Task created. It may be in an unloaded page or excluded by this view’s filters."
            : "Task created, but this view does not show it. Its filters or result limit may exclude it.",
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
        }${captureDefaults ? " has-context-capture" : ""}${manualOrder && arrangingViewKey === selected?.key ? " is-arranging" : ""}${presentationClass}`}
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
            {selected?.name === "Today" ? (
              <p className="view-date">
                {new Intl.DateTimeFormat(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                }).format(new Date())}
              </p>
            ) : null}
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
                <ViewOptions>
                  <button
                    type="button"
                    aria-pressed={Boolean(manualOrder)}
                    disabled={
                      manualOrderSortPending !== null ||
                      manualOrderPendingForSelected ||
                      currentExecutionRefreshing
                    }
                    onClick={() => void setManualOrderSort(!manualOrder)}
                  >
                    {manualOrder ? (
                      <Check aria-hidden="true" size={18} />
                    ) : (
                      <GripVertical aria-hidden="true" size={18} />
                    )}{" "}
                    Manual order
                  </button>
                  <ArrangeTasksOption
                    available={Boolean(manualOrder)}
                    arrangingViewKey={arrangingViewKey}
                    viewKey={selected.key}
                    onChange={setArrangingViewKey}
                  />
                  <button
                    type="button"
                    aria-label={`Edit ${selected.name}`}
                    onFocus={preloadViewEditor}
                    onPointerEnter={preloadViewEditor}
                    onClick={() => setEditing({ view: selected })}
                  >
                    <Pencil aria-hidden="true" size={18} /> Edit view
                  </button>
                </ViewOptions>
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
        {selected && !editing ? (
          <ProjectPropertyOffer
            scope={sectionScope}
            view={selected}
            onChanged={onViewsChanged}
          />
        ) : null}
        {presentedExecution?.hasMore ? (
          <p className="view-note" role="status">
            Loaded {presentedExecution.rows.length} of{" "}
            {presentedExecution.totalCount} matching tasks. Section counts cover
            loaded tasks.{" "}
            {manualOrder ? "Load remaining tasks to change manual order." : ""}
          </p>
        ) : null}
        {manualOrder && presentedExecution?.hasMore ? (
          <button
            type="button"
            className="text-action"
            disabled={currentExecutionRefreshing}
            onClick={() => {
              const key = selected?.key;
              void viewQueryRef.current?.loadAll().then((complete) => {
                if (complete && key) queryRowsRef.current.set(key, Infinity);
              });
            }}
          >
            {currentExecutionRefreshing
              ? "Loading tasks…"
              : "Load remaining tasks"}
          </button>
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
          <>
            <button
              className="global-capture-fab view-context-capture"
              type="button"
              aria-label="New task"
              onClick={() => setMobileCaptureOpen(true)}
            >
              <Plus aria-hidden="true" size={24} />
              <span>Add task</span>
            </button>
            <GlobalTaskCapture
              createTask={createTaskForView}
              session={captureSession}
              open={mobileCaptureOpen}
              defaults={captureDefaults}
              onClose={closeMobileCapture}
              onCreated={refreshAfterCreate}
              onAdded={onTaskAdded}
              onOpenTask={onOpenTask}
            />
          </>
        ) : null}
        {captureDefaults ? (
          <TaskCapture
            session={captureSession}
            key={selected?.key}
            configuration={configuration}
            createTask={createTaskForView}
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
            key={`${sectionScope}:${selected?.key}`}
            sectionScope={sectionScope}
            execution={presentedExecution}
            linkWriteFormat={configuration.linkWriteFormat}
            projectsField={configuration.fieldMapping.projects}
            tasks={identityTasks}
            onCreate={(value, label) => {
              if (!selected) return;
              setCreationContext({
                key: selected.key,
                label,
                defaults: { projects: [value] },
                focusRequest: Date.now(),
              });
              if (window.matchMedia?.("(max-width: 839px)").matches)
                setMobileCaptureOpen(true);
            }}
            onOpen={onOpenTask}
            onToggle={toggleRow}
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
            onToggle={toggleRow}
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
            onCreate={(date, createValue = date, timeEstimate) => {
              if (!selected) return;
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
              });
              if (window.matchMedia?.("(max-width: 839px)").matches)
                setMobileCaptureOpen(true);
            }}
            onOpen={onOpenTask}
            onToggle={toggleRow}
            onUpdate={calendarMutations.updateTask}
            onUpdateOccurrence={calendarMutations.updateOccurrence}
            onReplaceTimeEntries={calendarMutations.replaceTimeEntries}
          />
        ) : (
          <TaskListView
            sectionScope={sectionScope}
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
            orderPending={
              manualOrderPendingForSelected || currentExecutionRefreshing
            }
            orderUnavailable={orderUnavailable}
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
            onToggle={toggleRow}
          />
        )}
        {paging.key === selected?.key && paging.used && !error ? (
          <button
            className="text-action view-pagination-action"
            type="button"
            aria-disabled={currentExecutionRefreshing || !paging.available}
            onClick={() => {
              if (!currentExecutionRefreshing && paging.available)
                void viewQueryRef.current?.loadMore();
            }}
          >
            {currentExecutionRefreshing
              ? "Loading tasks…"
              : paging.available
                ? "Load more tasks"
                : "All matching tasks loaded"}
          </button>
        ) : null}
      </section>
    </>
  );
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

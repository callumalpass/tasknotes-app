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
import { useViewExecution } from "./use-view-execution";
import { canReorderExecution } from "./manual-order-availability";
import { ArrangeTasksOption } from "../components/arrange-tasks-option";
import { basesProperty } from "../domain/default-view-source";
import { ProjectPropertyOffer } from "./views/project-property-offer";
import { kanbanRowValue, valueKey } from "./views/kanban-columns";
import { navigationViewScope } from "./navigation-views";
import { LoadingRows } from "../components/loading";
import { OperationErrorNotice } from "../components/operation-error-notice";
import { ViewExecutionErrorNotice } from "../components/view-execution-error-notice";
import { taskCompletion } from "../domain/task-completion";
import { TaskCapture } from "../components/task-capture";
import { todayString } from "../domain/task";
import {
  scheduleRowsTodayUpdates,
  sectionTaskViewRows,
} from "../domain/task-list-sections";
import { summarizeToday } from "../domain/today-summary";
import { TodayClear, TodayFirstRun } from "./today-clear";
import { CaptureFab } from "../components/capture-fab";
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
import { useRepository, useTasks } from "./repository-context";
import { RecordWriteNotice } from "../components/record-write-notice";
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
  executionWithDepartures,
  type CompletionDeparture,
} from "./optimistic-view-reconciliation";
import {
  COMPLETION_FOLD_MS,
  COMPLETION_LINGER_MS,
  TaskCompletionHoldsContext,
  TaskDeparturesContext,
  prefersReducedMotion,
} from "../components/task-completion-motion";
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
import { StarterViewsOffer } from "./views/starter-views-offer";
import { useStableCallback, useStableView } from "./use-stable-identity";
import { hasTaskNotesStarterViews } from "../application/ensure-default-view-source";

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
  creationRequest = 0,
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
  /** Explicit shell action opens the existing editor; discovery never writes. */
  creationRequest?: number;
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
  // A completed row that leaves the results is held where it was, so it can
  // linger and fold away; rows that stay (or move) are left to the result.
  const [departures, setDepartures] = useState<
    ReadonlyMap<string, CompletionDeparture>
  >(() => new Map());
  const presentedRef = useRef<TaskViewExecution | null>(null);
  const toggleRow = async (task: TaskSummary, occurrenceDate?: string) => {
    const completed = !taskCompletion(task, occurrenceDate);
    const shown = presentedRef.current;
    const index =
      completed && shown && !prefersReducedMotion()
        ? shown.rows.findIndex((row) => row.task.id === task.id)
        : -1;
    const departure: CompletionDeparture | undefined =
      shown && index >= 0
        ? {
            viewKey: shown.view.key,
            row: shown.rows[index]!,
            index,
            groups: shown.groups,
            acceptedAt: null,
          }
        : undefined;
    const settle = (next?: CompletionDeparture) =>
      setDepartures((current) => {
        if (current.get(task.id)?.row !== departure?.row) return current;
        const updated = new Map(current);
        if (next) updated.set(task.id, next);
        else updated.delete(task.id);
        return updated;
      });
    if (departure)
      setDepartures((current) => new Map(current).set(task.id, departure));
    try {
      const saved = await setTaskCompletion({
        id: task.id,
        occurrenceDate,
        completed,
      });
      if (departure) {
        settle({ ...departure, acceptedAt: Date.now() });
        window.setTimeout(
          () => settle(),
          COMPLETION_LINGER_MS + COMPLETION_FOLD_MS + 40,
        );
      }
      return saved;
    } catch (reason) {
      if (departure) settle();
      throw reason;
    }
  };
  const openTask = useStableCallback(onOpenTask);
  const toggleTask = useStableCallback(
    (task: TaskSummary, occurrenceDate?: string) =>
      void toggleRow(task, occurrenceDate),
  );
  const [editing, setEditing] = useState<ViewEditorRequest | null>(null);
  const [handledCreationRequest, setHandledCreationRequest] = useState(0);
  if (creationRequest !== handledCreationRequest) {
    setHandledCreationRequest(creationRequest);
    if (creationRequest > 0) setEditing({});
  }
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
  const [rescheduled, setRescheduled] = useState<{
    viewKey: string;
    count: number;
    undo: { id: string; input: UpdateTaskInput }[];
  } | null>(null);
  const [reschedulePending, setReschedulePending] = useState(false);
  const rescheduleUndoRef = useRef<HTMLButtonElement | null>(null);
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

  const selected = useStableView(views?.find((view) => view.key === viewKey));
  const captureSession = captureSessionFor(
    repository,
    `view:${viewKey ?? "catalog"}`,
  );
  const plannerHref = usePlannerViewLink(repository, selected);
  const todayScreen =
    selected?.presentation?.options.sections === "day" &&
    (selected.id === "today" || selected.name === "Today");
  const needsIdentityTasks =
    todayScreen ||
    selected?.presentation?.type === "tasknotes.calendar" ||
    selected?.presentation?.type === "tasknotes.mini-calendar" ||
    selected?.presentation?.type === "tasknotes.projects";
  const {
    tasks: identityTasks,
    loading: identityTasksLoading,
    error: identityTasksError,
  } = useTasks({
    status: "all",
    limit: needsIdentityTasks ? 50_000 : 0,
  });
  const today = todayString();
  const todaySummary = useMemo(
    () => (todayScreen ? summarizeToday(identityTasks, today) : null),
    [identityTasks, today, todayScreen],
  );
  const selectedKey = selected?.key;
  const selectedKeyRef = useRef(selectedKey);
  useEffect(() => {
    selectedKeyRef.current = selectedKey;
  }, [selectedKey]);
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
  const {
    currentSession,
    rememberAllRows,
    retryExecution,
    execution,
    setExecution,
    executionError,
    setExecutionError,
    refreshingExecution,
    revalidatingExecution,
    paging,
  } = useViewExecution(
    repository,
    selected,
    viewKey,
    configuration.fieldMapping.sortOrder,
    reconcileOptimisticExecution,
  );
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
  useEffect(() => {
    if (!viewKey || !selected) return;
    let active = true;
    void (
      currentSession()?.readSource() ??
      repository.readViewSource(selected.source.path)
    )
      .then((source) => {
        if (!active) return;
        setSourceSort({
          key: selected.key,
          sort: readViewDraft(source, selected.id, selected.declaration).sort,
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
  }, [configuration, repository, selected, viewKey, currentSession]);
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
  const { execution: presentedExecution, departing } = useMemo(() => {
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
    const held =
      ranked && selected
        ? executionWithDepartures(ranked, departures, selected.key)
        : { execution: ranked, departing: new Map<string, number | null>() };
    return {
      execution:
        held.execution && pendingDeletion
          ? executionWithoutTask(held.execution, pendingDeletion.id)
          : held.execution,
      departing: held.departing,
    };
  }, [
    configuration.fieldMapping.sortOrder,
    departures,
    manualOrder,
    manualRanks,
    pendingDeletion,
    selected,
    visibleExecution,
  ]);
  const todayProgress = useMemo(() => {
    if (
      !todayScreen ||
      !todaySummary?.completedToday ||
      identityTasksLoading ||
      !presentedExecution ||
      presentedExecution.hasMore
    )
      return null;
    // Open rows the Today section shows, including optimistic moves into it.
    const todayLane = sectionTaskViewRows(presentedExecution.rows, "day", today)
      .find(({ key }) => key === "today")
      ?.rows.map(({ task }) => task.id);
    const open = presentedExecution.rows.filter(({ task }) => {
      if (task.completed) return false;
      const move = listMoves.get(task.id);
      return move?.viewKey === selected?.key
        ? move.laneKey === "section:today"
        : todayLane?.includes(task.id);
    }).length;
    const done = todaySummary.completedToday;
    return { done, total: done + open };
  }, [
    identityTasksLoading,
    listMoves,
    presentedExecution,
    selected?.key,
    today,
    todayScreen,
    todaySummary,
  ]);
  useEffect(() => {
    if (!rescheduled) return;
    const timeout = window.setTimeout(() => setRescheduled(null), 30_000);
    return () => window.clearTimeout(timeout);
  }, [rescheduled]);
  const upcomingView = views?.find(
    (view) => view.id === "upcoming" && view.key !== selected?.key,
  );
  useEffect(() => {
    presentedRef.current = presentedExecution;
  });
  const holds = useMemo(
    () =>
      new Map(
        [...departures]
          .filter(([, departure]) => departure.viewKey === selected?.key)
          .map(([taskId, departure]) => [taskId, departure.acceptedAt]),
      ),
    [departures, selected?.key],
  );
  const currentExecutionRefreshing =
    refreshingExecution ===
    (selected ? `${selected.key}:${selected.source.revision}` : null);
  const error =
    executionError?.key === selected?.key ? executionError?.reason : viewsError;
  // A background re-query keeps controls as they are on screen, but manual
  // order still waits for it before planning a move from the shown ranks.
  const currentExecutionRevalidating =
    revalidatingExecution ===
    (selected ? `${selected.key}:${selected.source.revision}` : null);
  const orderUnavailable =
    Boolean(error) ||
    currentExecutionRefreshing ||
    !canReorderExecution(presentedExecution);
  const reorderBlocked = orderUnavailable || currentExecutionRevalidating;
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
      const draft = readViewDraft(source, view.id, view.declaration);
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
    if (!selected || !manualOrder || reorderBlocked) return false;
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
      let accepted = false;
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
        accepted = true;
        const refreshed = await repository.executeView(view);
        if (selectedKeyRef.current === view.key) {
          setExecution(refreshed);
          setExecutionError(null);
          reconcileOptimisticExecution(refreshed, view.key);
        }
        return true;
      } catch (reason) {
        // Local acceptance is not a failed move, even if its subsequent READ
        // fails. Retain the accepted overlay; ordinary change notifications
        // refresh/reconcile it, and the query session owns actual stale errors.
        if (accepted) return true;
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
        : kanbanRowValue(row, property);
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
    } catch {
      // The mutation was accepted. Keep its overlay and let the normal query
      // refresh on the next data notification, without an action-failure claim.
      // Query-session stale/read failures retain their own truthful notice.
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

  /**
   * Move a set of rows to another day section as one batch: rows move
   * optimistically, the repository writes them together, and the view is
   * re-read so the overlay reconciles exactly as single moves do.
   */
  async function moveRowsToSection(
    updates: readonly { id: string; input: UpdateTaskInput }[],
    laneKey: string,
  ): Promise<boolean> {
    if (!selected || !updates.length) return false;
    const view = selected;
    const sequences = new Map(
      updates.map(({ id }) => {
        const sequence = (viewMutationSequence.current.get(id) ?? 0) + 1;
        viewMutationSequence.current.set(id, sequence);
        return [id, sequence] as const;
      }),
    );
    setViewActionError(null);
    setListMoves((moves) => {
      const next = new Map(moves);
      for (const { id, input } of updates)
        next.set(id, {
          viewKey: view.key,
          laneKey,
          input,
          sequence: sequences.get(id)!,
        });
      return next;
    });
    selectionFeedback();
    try {
      await updateTasks(updates);
    } catch (reason) {
      setListMoves((moves) => {
        const next = new Map(moves);
        for (const [id, sequence] of sequences)
          if (next.get(id)?.sequence === sequence) next.delete(id);
        return next;
      });
      if (selectedKeyRef.current === view.key)
        setViewActionError({
          viewKey: view.key,
          message: `Could not reschedule ${updates.length === 1 ? "the task" : `${updates.length} tasks`}. ${message(reason)}`,
        });
      return false;
    }
    try {
      const refreshed = await repository.executeView(view);
      if (selectedKeyRef.current === view.key) {
        setExecution(refreshed);
        setExecutionError(null);
        reconcileOptimisticExecution(refreshed, view.key);
      }
    } catch {
      // Accepted writes keep their overlay until the next refresh reconciles.
    }
    return true;
  }

  async function moveOverdueToToday(rows: readonly TaskViewRow[]) {
    if (!selected || reschedulePending) return;
    const view = selected;
    const updates = scheduleRowsTodayUpdates(rows);
    if (!updates.length) return;
    setReschedulePending(true);
    setRescheduled(null);
    // The Overdue heading leaves with its rows; keep focus in the page.
    document.getElementById("main-content")?.focus({ preventScroll: true });
    try {
      const saved = await moveRowsToSection(
        updates.map(({ id, input }) => ({ id, input })),
        "section:today",
      );
      if (saved && selectedKeyRef.current === view.key) {
        setRescheduled({
          viewKey: view.key,
          count: updates.length,
          undo: updates.map(({ id, undo }) => ({ id, input: undo })),
        });
        window.requestAnimationFrame(() => rescheduleUndoRef.current?.focus());
      }
    } finally {
      setReschedulePending(false);
    }
  }

  async function undoReschedule() {
    if (!rescheduled || reschedulePending) return;
    const { undo } = rescheduled;
    setRescheduled(null);
    setReschedulePending(true);
    document.getElementById("main-content")?.focus({ preventScroll: true });
    try {
      await moveRowsToSection(undo, "section:overdue");
    } finally {
      setReschedulePending(false);
    }
  }

  async function createTaskForView(
    input: CreateTaskInput,
    intent?: import("../application/ports/task-repository").TaskCreateIntent,
  ) {
    if (selected && manualOrder && presentedExecution?.hasMore) {
      const complete = await repository.executeView(selected);
      if (complete.stale || complete.hasMore || complete.hasSkippedRecords)
        throw new Error(
          "The complete manual order could not be loaded. Your draft is kept; try again.",
        );
      return createTask(
        {
          ...input,
          sortOrder: appendManualOrderRank(
            complete.rows.map((row) => row.task),
            manualOrder.direction,
          ),
        },
        intent,
      );
    }
    return createTask(input, intent);
  }

  async function refreshAfterCreate(task: TaskSummary) {
    if (!selected) return;
    const session = currentSession();
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
          {documents && !hasTaskNotesStarterViews(documents) ? (
            <StarterViewsOffer onAdded={onViewsChanged} />
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
    <CompletionMotion holds={holds} departing={departing}>
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
            {selected ? (
              <RecordWriteNotice
                repository={repository}
                target={{ kind: "source", path: selected.source.path }}
              />
            ) : null}
            {selected?.name === "Today" ? (
              <p className="view-date">
                {new Intl.DateTimeFormat(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                }).format(new Date())}
                {todayProgress ? (
                  <span className="today-progress">
                    {" "}
                    · {todayProgress.done} of {todayProgress.total} done
                  </span>
                ) : null}
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
            onRetry={retryExecution}
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
              void currentSession()
                ?.loadAll()
                .then((complete) => {
                  if (complete && key) rememberAllRows(key);
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
            recovery="Review the task before making another change."
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
            <CaptureFab
              className="view-context-capture"
              aria-label="New task"
              onClick={() => setMobileCaptureOpen(true)}
            />
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
            onOpen={openTask}
            onToggle={toggleTask}
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
            onOpen={openTask}
            onToggle={toggleTask}
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
            onOpen={openTask}
            onToggle={toggleTask}
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
            onOpen={openTask}
            onToggle={toggleTask}
            sectionAction={(lane) =>
              lane.key === "section:overdue" && lane.rows.length ? (
                <button
                  className="section-heading-action"
                  type="button"
                  aria-label={`Move all to today, ${lane.rows.length} overdue ${lane.rows.length === 1 ? "task" : "tasks"}`}
                  disabled={reschedulePending}
                  onClick={() => void moveOverdueToToday(lane.rows)}
                >
                  Move all to today
                </button>
              ) : null
            }
            emptyState={
              todayScreen &&
              !presentedExecution.stale &&
              !identityTasksLoading &&
              !identityTasksError &&
              !identityTasks.length ? (
                <TodayFirstRun />
              ) : todayScreen &&
                !presentedExecution.stale &&
                identityTasksLoading ? (
                <div className="today-clear" aria-busy="true" />
              ) : todayScreen && !presentedExecution.stale ? (
                <TodayClear
                  loading={identityTasksLoading}
                  next={todaySummary?.next}
                  onOpenTask={onOpenTask}
                  onOpenUpcoming={
                    upcomingView ? () => onOpenView(upcomingView) : undefined
                  }
                />
              ) : undefined
            }
            daySectionsClear={
              todayScreen ? (
                <TodayClear
                  loading={identityTasksLoading}
                  next={todaySummary?.next}
                  onOpenTask={onOpenTask}
                  onOpenUpcoming={
                    upcomingView ? () => onOpenView(upcomingView) : undefined
                  }
                />
              ) : undefined
            }
          />
        )}
        {rescheduled && rescheduled.viewKey === selected?.key ? (
          <>
            <p aria-atomic="true" className="visually-hidden" role="status">
              Moved {rescheduled.count}{" "}
              {rescheduled.count === 1 ? "task" : "tasks"} to today.
            </p>
            {!pendingDeletion ? (
              <div className="undo-toast is-above-mobile-controls">
                <span>
                  Moved {rescheduled.count}{" "}
                  {rescheduled.count === 1 ? "task" : "tasks"} to today
                </span>
                <button
                  ref={rescheduleUndoRef}
                  type="button"
                  onClick={() => void undoReschedule()}
                >
                  Undo
                </button>
              </div>
            ) : null}
          </>
        ) : null}
        {paging.key === selected?.key && paging.used && !error ? (
          <button
            className="text-action view-pagination-action"
            type="button"
            aria-disabled={currentExecutionRefreshing || !paging.available}
            onClick={() => {
              if (!currentExecutionRefreshing && paging.available)
                void currentSession()?.loadMore();
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
    </CompletionMotion>
  );
}

/** Completion holds for the selected view, for its presentations' rows. */
function CompletionMotion({
  holds,
  departing,
  children,
}: {
  holds: ReadonlyMap<string, number | null>;
  departing: ReadonlyMap<string, number | null>;
  children: React.ReactNode;
}) {
  return (
    <TaskCompletionHoldsContext.Provider value={holds}>
      <TaskDeparturesContext.Provider value={departing}>
        {children}
      </TaskDeparturesContext.Provider>
    </TaskCompletionHoldsContext.Provider>
  );
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

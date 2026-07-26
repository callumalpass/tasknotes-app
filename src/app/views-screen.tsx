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
    configuration,
    version,
  } = useRepository();
  const { tasks: identityTasks } = useTasks({ status: "all", limit: 50_000 });
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
    Map<string, { viewKey: string; property: string; value: unknown }>
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
  const boardMutationSequence = useRef(new Map<string, number>());
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
        setCreationPlan({
          key: selected.key,
          revision: selected.source.revision,
          plan: createPlanForView(selected, source, configuration),
        });
      })
      .catch(() => {
        if (!active) return;
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
  const captureDefaults =
    selected?.presentation?.options.create === false
      ? null
      : selected?.presentation?.type === "tasknotes.projects" &&
          !currentCreationContext
        ? null
        : currentCreationPlan
          ? mergeTaskCreationDefaults(
              currentCreationPlan.defaults,
              mergeTaskCreationDefaults(
                calendarCreateDefaults,
                currentCreationContext?.defaults ?? {},
              ),
            )
          : null;

  async function moveBoardTask(
    row: TaskViewRow,
    property: string,
    value: unknown,
  ) {
    if (!selected) return;
    const input = kanbanMoveInput(
      row.task,
      property,
      value,
      configuration.fieldMapping,
    );
    if (!input) {
      setViewActionError({
        viewKey: selected.key,
        message: `${propertyLabel(property)} is calculated by this view and cannot be changed here.`,
      });
      return;
    }
    const optimistic = boardMoves.get(row.task.id);
    const current =
      optimistic?.viewKey === selected.key && optimistic.property === property
        ? optimistic.value
        : (row.values[property] ?? row.task.frontmatter[property] ?? null);
    if (valueKey(current) === valueKey(value)) return;

    const sequence = (boardMutationSequence.current.get(row.task.id) ?? 0) + 1;
    boardMutationSequence.current.set(row.task.id, sequence);
    setViewActionError(null);
    setBoardMoves((moves) => {
      const next = new Map(moves);
      next.set(row.task.id, { viewKey: selected.key, property, value });
      return next;
    });
    selectionFeedback();

    try {
      await updateTask(row.task.id, input);
    } catch (reason) {
      if (boardMutationSequence.current.get(row.task.id) !== sequence) return;
      clearBoardMove(row.task.id);
      if (selectedKeyRef.current === selected.key)
        setViewActionError({
          viewKey: selected.key,
          message: `Could not move “${row.task.title}”. ${message(reason)}`,
        });
      return;
    }

    if (boardMutationSequence.current.get(row.task.id) !== sequence) return;
    try {
      const refreshed = await repository.executeView(selected);
      if (boardMutationSequence.current.get(row.task.id) !== sequence) return;
      clearBoardMove(row.task.id);
      if (selectedKeyRef.current !== selected.key) return;
      setExecution(refreshed);
      setExecutionError(null);
    } catch (reason) {
      if (boardMutationSequence.current.get(row.task.id) !== sequence) return;
      clearBoardMove(row.task.id);
      if (selectedKeyRef.current === selected.key)
        setViewActionError({
          viewKey: selected.key,
          message: `The move was saved, but this view could not refresh. ${message(reason)}`,
        });
    }
  }

  function clearBoardMove(taskId: string) {
    setBoardMoves((moves) => {
      if (!moves.has(taskId)) return moves;
      const next = new Map(moves);
      next.delete(taskId);
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
                Views from this collection will appear here when you add one.
              </p>
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
        }`}
        aria-live="polite"
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
              <small>Updating</small>
            ) : visibleExecution?.stale ? (
              <small>Last available result</small>
            ) : operational ? (
              <small>In navigation</small>
            ) : null}
          </div>
          {selected?.source.writable && !editing ? (
            <button
              aria-label={`Edit ${selected.name}`}
              className="edit-view-action"
              type="button"
              onFocus={preloadViewEditor}
              onClick={() => setEditing(selected)}
              onPointerEnter={preloadViewEditor}
            >
              <Pencil aria-hidden="true" size={16} /> Edit view
            </button>
          ) : null}
        </header>
        {error ? <p className="inline-error">{error}</p> : null}
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
        {!visibleExecution ? (
          <LoadingRows count={6} />
        ) : visibleExecution.view.presentation?.type ===
          "tasknotes.projects" ? (
          <ProjectsView
            execution={visibleExecution}
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
        ) : visibleExecution.view.presentation?.type === "tasknotes.kanban" ? (
          <KanbanView
            fieldMapping={configuration.fieldMapping}
            execution={visibleExecution}
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
            onMove={(row, property, value) =>
              void moveBoardTask(row, property, value)
            }
            onCreateInColumn={createInBoardColumn}
            canCreateInColumn={canCreateInBoardColumn}
            onOpen={onOpenTask}
            onToggle={(task, occurrenceDate) =>
              void toggleTask(task.id, occurrenceDate)
            }
          />
        ) : visibleExecution.view.presentation?.type ===
          "tasknotes.calendar" ? (
          <Suspense fallback={<LoadingRows count={6} />}>
            <FullCalendarView
              key={`${visibleExecution.view.key}:${visibleExecution.view.source.revision}`}
              execution={visibleExecution}
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
        ) : visibleExecution.view.presentation?.type ===
          "tasknotes.mini-calendar" ? (
          <MiniCalendarView
            key={`${visibleExecution.view.key}:${visibleExecution.view.source.revision}`}
            execution={visibleExecution}
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
            execution={visibleExecution}
            titleProperty={configuration.fieldMapping.title}
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
  moves: Map<string, { viewKey: string; property: string; value: unknown }>;
  priorityColumns: Array<{ value: string; label: string }>;
  statusColumns: Array<{ value: string; label: string }>;
  onMove(row: TaskViewRow, property: string, value: unknown): void;
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
  const [dragging, setDragging] = useState<{
    row: TaskViewRow;
    sourceKey: string;
  } | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
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
  } | null>(null);
  const pointerPosition = useRef<{ x: number; y: number } | null>(null);
  const autoScrollFrame = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (autoScrollFrame.current !== null)
        cancelAnimationFrame(autoScrollFrame.current);
    },
    [],
  );

  function beginMove(row: TaskViewRow, sourceKey: string) {
    const active = { row, sourceKey };
    draggingRef.current = active;
    setDragging(active);
    setOverKey(sourceKey);
  }

  function clearDrag() {
    if (autoScrollFrame.current !== null) {
      cancelAnimationFrame(autoScrollFrame.current);
      autoScrollFrame.current = null;
    }
    draggingRef.current = null;
    pointerDrag.current = null;
    pointerPosition.current = null;
    setDragging(null);
    setOverKey(null);
  }

  function finishMove(
    row: TaskViewRow,
    sourceKey: string,
    destinationKey: string | null,
  ) {
    const destination = orderedColumns.find(
      (column) => valueKey(column.value) === destinationKey,
    );
    if (destination && destinationKey !== sourceKey) {
      onMove(row, property, destination.value);
      setAnnouncement(
        `Moved ${row.task.title} to ${destination.label ?? columnLabel(destination.value)}.`,
      );
    }
    clearDrag();
  }

  function destinationAt(clientX: number, clientY: number): string | null {
    const board = boardRef.current;
    const bounds = board?.getBoundingClientRect();
    const x = bounds
      ? Math.max(bounds.left + 1, Math.min(clientX, bounds.right - 1))
      : clientX;
    const y = bounds
      ? Math.max(bounds.top + 1, Math.min(clientY, bounds.bottom - 1))
      : clientY;
    return (
      document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-kanban-column-key]")
        ?.getAttribute("data-kanban-column-key") ?? null
    );
  }

  function continueAutoScroll() {
    autoScrollFrame.current = null;
    const board = boardRef.current;
    const pointer = pointerPosition.current;
    if (!board || !pointer || !pointerDrag.current) return;
    const bounds = board.getBoundingClientRect();
    const edge = 52;
    let distance = 0;
    if (pointer.x < bounds.left + edge)
      distance = -Math.max(
        4,
        Math.ceil(((bounds.left + edge - pointer.x) / edge) * 18),
      );
    else if (pointer.x > bounds.right - edge)
      distance = Math.max(
        4,
        Math.ceil(((pointer.x - (bounds.right - edge)) / edge) * 18),
      );
    if (!distance) return;

    const previous = board.scrollLeft;
    board.scrollLeft += distance;
    setOverKey(destinationAt(pointer.x, pointer.y));
    if (board.scrollLeft !== previous)
      autoScrollFrame.current = requestAnimationFrame(continueAutoScroll);
  }

  function startAutoScroll() {
    if (autoScrollFrame.current === null)
      autoScrollFrame.current = requestAnimationFrame(continueAutoScroll);
  }

  return (
    <>
      {!writable ? (
        <p className="view-note">
          This board groups by a calculated property, so its cards are
          read-only.
        </p>
      ) : null}
      <div
        className={`kanban-board${dragging ? " is-dragging" : ""}`}
        aria-label={`${execution.view.name} board`}
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
              onDragOver={(event) => {
                if (!draggingRef.current || !writable) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setOverKey(key);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const active = draggingRef.current;
                if (active) finishMove(active.row, active.sourceKey, key);
              }}
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
              <div>
                {column.rows.map((row) => {
                  const pending = moves.has(row.task.id);
                  return (
                    <div
                      aria-busy={pending}
                      className={`kanban-card${pending ? " is-pending" : ""}${dragging?.row.task.id === row.task.id ? " is-dragging" : ""}`}
                      draggable={writable}
                      key={row.task.id}
                      onDragEnd={clearDrag}
                      onDragStart={(event) => {
                        if (
                          event.target instanceof Element &&
                          event.target.closest(
                            ".completion-control, .kanban-drag-handle, .task-actions-trigger",
                          )
                        ) {
                          event.preventDefault();
                          return;
                        }
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", row.task.id);
                        beginMove(row, key);
                      }}
                    >
                      {writable ? (
                        <button
                          aria-label={`Move ${row.task.title}. Drag, or use left and right arrow keys.`}
                          className="kanban-drag-handle"
                          type="button"
                          onContextMenu={(event) => event.preventDefault()}
                          onKeyDown={(event) => {
                            const direction =
                              event.key === "ArrowLeft"
                                ? -1
                                : event.key === "ArrowRight"
                                  ? 1
                                  : 0;
                            if (!direction) return;
                            const destination =
                              orderedColumns[columnIndex + direction];
                            if (!destination) return;
                            event.preventDefault();
                            finishMove(row, key, valueKey(destination.value));
                          }}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.currentTarget.setPointerCapture(
                              event.pointerId,
                            );
                            pointerDrag.current = {
                              pointerId: event.pointerId,
                              row,
                              sourceKey: key,
                            };
                            pointerPosition.current = {
                              x: event.clientX,
                              y: event.clientY,
                            };
                            beginMove(row, key);
                          }}
                          onPointerMove={(event) => {
                            if (
                              pointerDrag.current?.pointerId !== event.pointerId
                            )
                              return;
                            event.preventDefault();
                            pointerPosition.current = {
                              x: event.clientX,
                              y: event.clientY,
                            };
                            setOverKey(
                              destinationAt(event.clientX, event.clientY),
                            );
                            startAutoScroll();
                          }}
                          onPointerCancel={clearDrag}
                          onPointerUp={(event) => {
                            const active = pointerDrag.current;
                            if (!active || active.pointerId !== event.pointerId)
                              return;
                            pointerDrag.current = null;
                            finishMove(
                              active.row,
                              active.sourceKey,
                              destinationAt(event.clientX, event.clientY),
                            );
                          }}
                        >
                          <GripVertical aria-hidden="true" size={16} />
                        </button>
                      ) : null}
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
              </div>
            </section>
          );
        })}
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </>
  );
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
  return (
    <div className="mini-calendar-view">
      <div className="mini-calendar-toolbar">
        <button
          aria-label="Previous month"
          type="button"
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
          }
        >
          <ChevronLeft aria-hidden="true" size={20} />
        </button>
        <h2>{monthLabel}</h2>
        <button
          aria-label="Next month"
          type="button"
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
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
        {days.map((day) => {
          const date = storageDate(day);
          const entries = events.get(date) ?? [];
          const count = entries.length;
          return (
            <button
              aria-label={`${day.toLocaleDateString()}, ${count} ${count === 1 ? "task" : "tasks"}`}
              aria-selected={selected === date}
              className={day.getMonth() === month.getMonth() ? "" : "outside"}
              key={date}
              role="gridcell"
              type="button"
              onClick={() => onSelect(date)}
            >
              <span className="mini-calendar-date-number">{day.getDate()}</span>
              {count ? (
                <span className="mini-calendar-cell-tasks" aria-hidden="true">
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
  execution,
  titleProperty,
  onOpen,
  onToggle,
}: ViewProps & { titleProperty: string }) {
  if (!execution.rows.length)
    return (
      <div className="plain-empty task-list-view">
        <h2>Nothing here</h2>
        <p>This view has no matching tasks.</p>
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
            <div className="saved-task-list">
              {group.rows.map((row) => (
                <ViewTaskRow
                  key={row.task.id}
                  row={row}
                  properties={execution.view.properties}
                  titleProperty={titleProperty}
                  onOpen={onOpen}
                  onToggle={onToggle}
                />
              ))}
            </div>
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
            <div className="saved-task-list">
              {section.rows.map((row) => (
                <ViewTaskRow
                  key={row.task.id}
                  row={row}
                  properties={execution.view.properties}
                  titleProperty={titleProperty}
                  onOpen={onOpen}
                  onToggle={onToggle}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  return (
    <div className="saved-task-list task-list-view">
      {execution.rows.map((row) => (
        <ViewTaskRow
          key={row.task.id}
          row={row}
          properties={execution.view.properties}
          titleProperty={titleProperty}
          onOpen={onOpen}
          onToggle={onToggle}
        />
      ))}
    </div>
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

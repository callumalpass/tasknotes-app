import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns3,
  GripVertical,
  List,
  Pencil,
  Pin,
  Plus,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { LoadingRows } from "../components/loading";
import { TaskRow } from "../components/task-row";
import { calendarEvents } from "../domain/calendar-events";
import { isTaskNotesDefaultView } from "../domain/default-views";
import {
  kanbanMoveInput,
  kanbanPropertyRole,
  type KanbanFieldMapping,
} from "../domain/kanban";
import { dateFromStorage, todayString } from "../domain/task";
import { occurrenceTask } from "../domain/task-occurrence";
import { groupTaskViewRows } from "../domain/view-grouping";
import { selectionFeedback } from "../native/feedback";
import { useRepository, useTasks } from "./repository-context";
import { TodayScreen } from "./today-screen";
import { UpcomingScreen } from "./upcoming-screen";
import { ViewEditor } from "./view-editor";

import type { Task } from "../domain/task";
import type { TaskOccurrence } from "../domain/task-occurrence";
import type {
  TaskView,
  TaskViewDocument,
  TaskViewExecution,
  TaskViewProperty,
  TaskViewRow,
} from "../domain/view";

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
  const { repository, toggleTask, updateTask, configuration, version } =
    useRepository();
  const { tasks: identityTasks } = useTasks({ status: "all", limit: 50_000 });
  const [execution, setExecution] = useState<TaskViewExecution | null>(null);
  const [executionError, setExecutionError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [editing, setEditing] = useState<TaskView | "new" | null>(null);
  const [boardMoves, setBoardMoves] = useState<
    Map<string, { viewKey: string; property: string; value: unknown }>
  >(() => new Map());
  const [viewActionError, setViewActionError] = useState<{
    viewKey: string;
    message: string;
  } | null>(null);
  const boardMutationSequence = useRef(new Map<string, number>());

  const selected = views?.find((view) => view.key === viewKey);
  const selectedKey = selected?.key;
  const selectedKeyRef = useRef(selectedKey);
  useEffect(() => {
    selectedKeyRef.current = selectedKey;
  }, [selectedKey]);
  useEffect(() => {
    if (!viewKey || !selected || isTaskNotesDefaultView(selected)) return;
    let active = true;
    void repository.executeView(selected).then(
      (result) => {
        if (!active) return;
        setExecution(result);
        setExecutionError(null);
      },
      (reason) =>
        active &&
        setExecutionError({ key: selected.key, message: message(reason) }),
    );
    return () => {
      active = false;
    };
  }, [repository, selected, version, viewKey]);
  const visibleExecution =
    execution?.view.key === selected?.key ? execution : null;
  const currentExecutionError =
    executionError && executionError.key === selected?.key
      ? executionError.message
      : "";
  const error = viewKey ? currentExecutionError || viewsError : viewsError;
  const currentViewActionError =
    viewActionError && viewActionError.viewKey === selected?.key
      ? viewActionError.message
      : "";

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

  if (selected?.presentation?.type === "tasknotes.today")
    return (
      <TodayScreen
        onBack={operational ? undefined : onBack}
        onOpen={onOpenTask}
      />
    );
  if (selected?.presentation?.type === "tasknotes.upcoming")
    return (
      <UpcomingScreen
        onBack={operational ? undefined : onBack}
        onOpen={onOpenTask}
      />
    );

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
                onClick={() => setEditing("new")}
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
                      {document.source.format !== "tasknotes.builtin" ? (
                        <small>{document.source.path}</small>
                      ) : null}
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
                                onClick={() => setEditing(view)}
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
      <section className="screen views-screen view-detail" aria-live="polite">
        <header className={`view-header${operational ? " operational" : ""}`}>
          {!operational ? (
            <button className="back-action" type="button" onClick={onBack}>
              <ChevronLeft aria-hidden="true" size={20} />
              Views
            </button>
          ) : null}
          <div>
            <h1>{selected?.name ?? "Saved view"}</h1>
            {visibleExecution?.stale ? (
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
              onClick={() => setEditing(selected)}
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
            inline
            view={editing}
            onClose={() => setEditing(null)}
            onChanged={onViewsChanged}
          />
        ) : null}
        {!visibleExecution ? (
          <LoadingRows count={6} />
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
            onOpen={onOpenTask}
            onToggle={(task, occurrenceDate) =>
              void toggleTask(task.id, occurrenceDate)
            }
          />
        ) : visibleExecution.view.presentation?.type ===
          "tasknotes.calendar" ? (
          <CalendarView
            execution={visibleExecution}
            identityTasks={identityTasks}
            onOpen={onOpenTask}
            onToggle={(task, occurrenceDate) =>
              void toggleTask(task.id, occurrenceDate)
            }
          />
        ) : (
          <TaskListView
            execution={visibleExecution}
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
  onOpen,
  onToggle,
}: ViewProps & {
  fieldMapping: KanbanFieldMapping;
  moves: Map<string, { viewKey: string; property: string; value: unknown }>;
  priorityColumns: Array<{ value: string; label: string }>;
  statusColumns: Array<{ value: string; label: string }>;
  onMove(row: TaskViewRow, property: string, value: unknown): void;
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
  const pointerDrag = useRef<{
    pointerId: number;
    row: TaskViewRow;
    sourceKey: string;
  } | null>(null);

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
    setDragging(null);
    setOverKey(null);
  }

  function destinationAt(clientX: number, clientY: number): string | null {
    return (
      document
        .elementFromPoint(clientX, clientY)
        ?.closest<HTMLElement>("[data-kanban-column-key]")
        ?.getAttribute("data-kanban-column-key") ?? null
    );
  }

  return (
    <>
      {!writable ? (
        <p className="view-note">
          This board groups by a calculated property, so its cards are
          read-only.
        </p>
      ) : null}
      <div className="kanban-board" aria-label={`${execution.view.name} board`}>
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
                if (!dragging || !writable) return;
                event.preventDefault();
                setOverKey(key);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging) finishMove(dragging.row, dragging.sourceKey, key);
              }}
            >
              <header>
                <h2>{label}</h2>
                <span>{column.rows.length}</span>
              </header>
              <div>
                {column.rows.map((row) => {
                  const pending = moves.has(row.task.id);
                  return (
                    <div
                      className={`kanban-card${pending ? " is-pending" : ""}${dragging?.row.task.id === row.task.id ? " is-dragging" : ""}`}
                      key={row.task.id}
                    >
                      {writable ? (
                        <button
                          aria-label={`Move ${row.task.title}. Use left and right arrow keys, or drag.`}
                          className="kanban-drag-handle"
                          draggable
                          type="button"
                          onDragEnd={() => {
                            setDragging(null);
                            setOverKey(null);
                          }}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData(
                              "text/plain",
                              row.task.id,
                            );
                            setDragging({ row, sourceKey: key });
                            setOverKey(key);
                          }}
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
                            if (event.pointerType === "mouse") return;
                            event.currentTarget.setPointerCapture(
                              event.pointerId,
                            );
                            pointerDrag.current = {
                              pointerId: event.pointerId,
                              row,
                              sourceKey: key,
                            };
                            setDragging({ row, sourceKey: key });
                            setOverKey(key);
                          }}
                          onPointerMove={(event) => {
                            if (
                              pointerDrag.current?.pointerId !== event.pointerId
                            )
                              return;
                            setOverKey(
                              destinationAt(event.clientX, event.clientY),
                            );
                          }}
                          onPointerCancel={() => {
                            pointerDrag.current = null;
                            setDragging(null);
                            setOverKey(null);
                          }}
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

function CalendarView({
  execution,
  identityTasks,
  onOpen,
  onToggle,
}: ViewProps & { identityTasks: readonly Task[] }) {
  const initial = dateFromStorage(todayString()) ?? new Date();
  const [month, setMonth] = useState(
    () => new Date(initial.getFullYear(), initial.getMonth(), 1),
  );
  const [selected, setSelected] = useState(todayString());
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
    <div className="calendar-view">
      <div className="calendar-toolbar">
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
      <div className="calendar-weekdays" aria-hidden="true">
        {weekdays().map((day, index) => (
          <span key={`${day}:${index}`}>{day}</span>
        ))}
      </div>
      <div className="calendar-grid" role="grid" aria-label={monthLabel}>
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
              onClick={() => setSelected(date)}
            >
              <span className="calendar-date-number">{day.getDate()}</span>
              {count ? (
                <span className="calendar-cell-tasks" aria-hidden="true">
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
      <section className="calendar-agenda">
        <h2>{agendaLabel(selected)}</h2>
        {selectedTasks.length ? (
          selectedTasks.map((entry) => (
            <ViewTaskRow
              key={entry.occurrence?.key ?? entry.task.id}
              row={entry.row}
              properties={execution.view.properties}
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

function TaskListView({ execution, onOpen, onToggle }: ViewProps) {
  if (!execution.rows.length)
    return (
      <div className="plain-empty">
        <h2>Nothing here</h2>
        <p>This view has no matching tasks.</p>
      </div>
    );
  const groups = groupTaskViewRows(execution);
  if (groups.length)
    return (
      <div className="task-groups saved-view-groups">
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
    <div className="saved-task-list">
      {execution.rows.map((row) => (
        <ViewTaskRow
          key={row.task.id}
          row={row}
          properties={execution.view.properties}
          onOpen={onOpen}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
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
  omittedProperties = [],
  occurrence,
  onOpen,
  onToggle,
}: {
  row: TaskViewRow;
  properties: TaskViewProperty[];
  omittedProperties?: string[];
  occurrence?: TaskOccurrence;
  onOpen(task: Task): void;
  onToggle(task: Task): void;
}) {
  const details = properties.length
    ? properties.flatMap((property) => {
        if (property.hidden || omittedProperties.includes(property.key))
          return [];
        const value = propertyValue(row, property.key, occurrence);
        const formatted = formatPropertyValue(value, property.format);
        return formatted === null
          ? []
          : [
              {
                key: property.key,
                label: property.label ?? propertyLabel(property.key),
                value: formatted,
                ...(property.description
                  ? { description: property.description }
                  : {}),
              },
            ];
      })
    : undefined;
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

function propertyValue(
  row: TaskViewRow,
  key: string,
  occurrence?: TaskOccurrence,
): unknown {
  const displayed = occurrence ? occurrenceTask(occurrence) : row.task;
  const field = key.startsWith("note.") ? key.slice("note.".length) : key;
  if (occurrence && Object.prototype.hasOwnProperty.call(displayed, field))
    return displayed[field as keyof Task];
  if (Object.prototype.hasOwnProperty.call(row.values, key))
    return row.values[key];
  return displayed.frontmatter[field];
}

function propertyLabel(key: string): string {
  const name = key.split(".").at(-1) ?? key;
  const words = name
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : key;
}

function formatPropertyValue(value: unknown, format?: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) {
    const values = value
      .map((item) => formatPropertyValue(item))
      .filter((item): item is string => item !== null);
    return values.length ? values.join(", ") : null;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return new Intl.NumberFormat().format(value);
  if (typeof value === "string") {
    if (format === "date" || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const date = dateFromStorage(value);
      if (date)
        return new Intl.DateTimeFormat(undefined, {
          day: "numeric",
          month: "short",
          year:
            date.getFullYear() === new Date().getFullYear()
              ? undefined
              : "numeric",
        }).format(date);
    }
    if (
      value.includes("<") &&
      value.includes(">") &&
      typeof DOMParser !== "undefined"
    ) {
      const text = new DOMParser()
        .parseFromString(value, "text/html")
        .body.textContent?.trim();
      if (text) return text;
    }
    return value;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (typeof object.path === "string") return object.path;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function ViewIcon({ view }: { view: TaskView }) {
  const type = view.presentation?.type;
  const Icon =
    type === "tasknotes.kanban"
      ? Columns3
      : type === "tasknotes.calendar"
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

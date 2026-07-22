import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Columns3,
  List,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { LoadingRows } from "../components/loading";
import { TaskRow } from "../components/task-row";
import { dateFromStorage, taskDatePart, todayString } from "../domain/task";
import { useRepository } from "./repository-context";

import type { Task } from "../domain/task";
import type {
  TaskView,
  TaskViewExecution,
  TaskViewProperty,
  TaskViewRow,
} from "../domain/view";

export function ViewsScreen({
  viewKey,
  onBack,
  onOpenTask,
  onOpenView,
}: {
  viewKey?: string;
  onBack(): void;
  onOpenTask(task: Task): void;
  onOpenView(view: TaskView): void;
}) {
  const { repository, toggleTask, version } = useRepository();
  const [views, setViews] = useState<TaskView[] | null>(null);
  const [execution, setExecution] = useState<TaskViewExecution | null>(null);
  const [viewsError, setViewsError] = useState<string>("");
  const [executionError, setExecutionError] = useState<{
    key: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void repository.listViews().then(
      (result) => {
        if (!active) return;
        setViews(result);
        setViewsError("");
      },
      (reason) => active && setViewsError(message(reason)),
    );
    return () => {
      active = false;
    };
  }, [repository, version]);

  const selected = views?.find((view) => view.key === viewKey);
  useEffect(() => {
    if (!viewKey || !selected) return;
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

  if (!viewKey) {
    return (
      <section className="screen views-screen" aria-labelledby="views-title">
        <header className="screen-header compact-header">
          <div>
            <button className="back-action" type="button" onClick={onBack}>
              <ChevronLeft aria-hidden="true" size={20} />
              More
            </button>
            <p className="eyebrow">Your collection</p>
            <h1 id="views-title">Views</h1>
          </div>
        </header>
        {error ? <p className="inline-error">{error}</p> : null}
        {!views ? (
          <LoadingRows count={4} />
        ) : views.length ? (
          <div className="saved-view-list">
            {views.map((view) => (
              <button
                className="saved-view-row"
                key={view.key}
                type="button"
                onClick={() => onOpenView(view)}
              >
                <ViewIcon view={view} />
                <span>
                  <strong>{view.name}</strong>
                  <small>{view.documentName}</small>
                </span>
                <ChevronRight aria-hidden="true" size={18} />
              </button>
            ))}
          </div>
        ) : (
          <div className="plain-empty">
            <h2>No saved views yet</h2>
            <p>Views from this collection will appear here when you add one.</p>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="screen views-screen view-detail" aria-live="polite">
      <header className="view-header">
        <button className="back-action" type="button" onClick={onBack}>
          <ChevronLeft aria-hidden="true" size={20} />
          Views
        </button>
        <div>
          <h1>{selected?.name ?? "Saved view"}</h1>
          {visibleExecution?.stale ? (
            <small>Last available result</small>
          ) : null}
        </div>
      </header>
      {error ? <p className="inline-error">{error}</p> : null}
      {!visibleExecution ? (
        <LoadingRows count={6} />
      ) : visibleExecution.view.presentation?.type === "tasknotes.kanban" ? (
        <KanbanView
          execution={visibleExecution}
          onOpen={onOpenTask}
          onToggle={(task) => void toggleTask(task.id)}
        />
      ) : visibleExecution.view.presentation?.type === "tasknotes.calendar" ? (
        <CalendarView
          execution={visibleExecution}
          onOpen={onOpenTask}
          onToggle={(task) => void toggleTask(task.id)}
        />
      ) : (
        <TaskListView
          execution={visibleExecution}
          onOpen={onOpenTask}
          onToggle={(task) => void toggleTask(task.id)}
        />
      )}
    </section>
  );
}

function KanbanView({ execution, onOpen, onToggle }: ViewProps) {
  const property = execution.view.presentation?.mappings.column ?? "status";
  const columns = new Map<
    string,
    { value: unknown; rows: typeof execution.rows }
  >();
  for (const group of execution.groups) {
    const value = group.values[property] ?? null;
    columns.set(valueKey(value), { value, rows: [] });
  }
  for (const row of execution.rows) {
    const value =
      row.values[property] ?? row.task.frontmatter[property] ?? null;
    const key = valueKey(value);
    const column = columns.get(key) ?? { value, rows: [] };
    column.rows.push(row);
    columns.set(key, column);
  }
  return (
    <div className="kanban-board" aria-label={`${execution.view.name} board`}>
      {[...columns.values()].map((column) => (
        <section className="kanban-column" key={valueKey(column.value)}>
          <header>
            <h2>{columnLabel(column.value)}</h2>
            <span>{column.rows.length}</span>
          </header>
          <div>
            {column.rows.map((row) => (
              <ViewTaskRow
                key={row.task.id}
                row={row}
                properties={execution.view.properties}
                omittedProperties={[property]}
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

function CalendarView({ execution, onOpen, onToggle }: ViewProps) {
  const initial = dateFromStorage(todayString()) ?? new Date();
  const [month, setMonth] = useState(
    () => new Date(initial.getFullYear(), initial.getMonth(), 1),
  );
  const [selected, setSelected] = useState(todayString());
  const events = useMemo(() => calendarEvents(execution), [execution]);
  const days = calendarGrid(month);
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
        {weekdays().map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar-grid" role="grid" aria-label={monthLabel}>
        {days.map((day) => {
          const date = storageDate(day);
          const count = events.get(date)?.length ?? 0;
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
              <span>{day.getDate()}</span>
              {count ? <i aria-hidden="true">{count}</i> : null}
            </button>
          );
        })}
      </div>
      <section className="calendar-agenda">
        <h2>{agendaLabel(selected)}</h2>
        {selectedTasks.length ? (
          selectedTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
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

function ViewTaskRow({
  row,
  properties,
  omittedProperties = [],
  onOpen,
  onToggle,
}: {
  row: TaskViewRow;
  properties: TaskViewProperty[];
  omittedProperties?: string[];
  onOpen(task: Task): void;
  onToggle(task: Task): void;
}) {
  const details = properties.length
    ? properties.flatMap((property) => {
        if (property.hidden || omittedProperties.includes(property.key))
          return [];
        const value = propertyValue(row, property.key);
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
      onOpen={onOpen}
      onToggle={onToggle}
    />
  );
}

function propertyValue(row: TaskViewRow, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(row.values, key))
    return row.values[key];
  const field = key.startsWith("note.") ? key.slice("note.".length) : key;
  return row.task.frontmatter[field];
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
  onOpen(task: Task): void;
  onToggle(task: Task): void;
}

function calendarEvents(execution: TaskViewExecution): Map<string, Task[]> {
  const events = new Map<string, Task[]>();
  const options = execution.view.presentation?.options ?? {};
  const showScheduled = options.showScheduled !== false;
  const showDue = options.showDue !== false;
  for (const { task } of execution.rows) {
    for (const value of new Set([
      ...(showScheduled && task.scheduled ? [task.scheduled] : []),
      ...(showDue && task.due ? [task.due] : []),
    ])) {
      const date = taskDatePart(value);
      if (!date) continue;
      const tasks = events.get(date) ?? [];
      tasks.push(task);
      events.set(date, tasks);
    }
  }
  return events;
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

function columnLabel(value: unknown): string {
  if (value === null || value === "") return "No value";
  return String(value).replaceAll("-", " ");
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, {
  type DateClickArg,
  type EventResizeDoneArg,
} from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import timeGridPlugin from "@fullcalendar/timegrid";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { TaskActions } from "../components/task-actions";
import { TaskRow } from "../components/task-row";
import { calendarEvents, type CalendarEntry } from "../domain/calendar-events";
import { occurrenceTask, type TaskOccurrence } from "../domain/task-occurrence";
import { dateFromStorage, taskDatePart, todayString } from "../domain/task";
import {
  viewPropertyDetails,
  type ViewPropertyDetail,
} from "../domain/view-values";
import {
  calendarEventTimeFormat,
  type CalendarPreferences,
} from "./calendar-preferences";

import type {
  CalendarApi,
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
  DateSelectArg,
} from "@fullcalendar/core";
import type { Task, UpdateTaskInput } from "../domain/task";
import type { TaskViewExecution } from "../domain/view";

type CalendarMode =
  | "dayGridMonth"
  | "timeGridWeek"
  | "timeGridThreeDay"
  | "timeGridDay"
  | "listWeek";

interface CalendarEventMetadata {
  entry: CalendarEntry;
  dateField: "scheduled" | "due";
  occurrence?: TaskOccurrence;
}

export function FullCalendarView({
  execution,
  preferences,
  identityTasks,
  selected,
  selectedCreateValue,
  titleProperty,
  onSelect,
  onCreate,
  onOpen,
  onToggle,
  onUpdate,
}: {
  execution: TaskViewExecution;
  preferences: CalendarPreferences;
  identityTasks: readonly Task[];
  selected: string;
  selectedCreateValue: string;
  titleProperty: string;
  onSelect(date: string, createValue?: string): void;
  onCreate(date: string, createValue?: string, timeEstimate?: number): void;
  onOpen(task: Task, occurrenceDate?: string): void;
  onToggle(task: Task, occurrenceDate?: string): void;
  onUpdate(task: Task, input: UpdateTaskInput): Promise<void>;
}) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const initialMode = calendarMode(
    execution.view.presentation?.options.calendarView,
  );
  const [mode, setMode] = useState<CalendarMode>(initialMode);
  const [title, setTitle] = useState("");
  const [range, setRange] = useState(() => initialRange(selected, initialMode));
  const [mutationError, setMutationError] = useState("");
  const [contextAction, setContextAction] = useState<{
    id: number;
    metadata: CalendarEventMetadata;
    x: number;
    y: number;
  } | null>(null);
  const entries = useMemo(
    () => calendarEvents(execution, range.start, range.end, identityTasks),
    [execution, identityTasks, range],
  );
  const events = useMemo(
    () => fullCalendarEvents(entries, execution, titleProperty),
    [entries, execution, titleProperty],
  );
  const selectedEntries = entries.get(selected) ?? [];
  const listMode = mode === "listWeek";

  function api(): CalendarApi | undefined {
    return calendarRef.current?.getApi();
  }

  function changeMode(next: CalendarMode) {
    setMode(next);
    api()?.changeView(next);
  }

  async function moveEvent(info: EventDropArg) {
    const metadata = eventMetadata(info.event.extendedProps);
    if (!metadata || metadata.occurrence || !info.event.start) {
      info.revert();
      return;
    }
    setMutationError("");
    try {
      await onUpdate(metadata.entry.task, {
        [metadata.dateField]: calendarStorageValue(
          info.event.start,
          info.event.allDay,
        ),
      });
    } catch (reason) {
      info.revert();
      setMutationError(message(reason));
    }
  }

  async function resizeEvent(info: EventResizeDoneArg) {
    const metadata = eventMetadata(info.event.extendedProps);
    if (
      !metadata ||
      metadata.occurrence ||
      !info.event.start ||
      !info.event.end
    ) {
      info.revert();
      return;
    }
    const minutes = Math.max(
      1,
      Math.round(
        (info.event.end.getTime() - info.event.start.getTime()) / 60_000,
      ),
    );
    setMutationError("");
    try {
      await onUpdate(metadata.entry.task, { timeEstimate: minutes });
    } catch (reason) {
      info.revert();
      setMutationError(message(reason));
    }
  }

  function createFromSelection(info: DateSelectArg) {
    const date = info.startStr.slice(0, 10);
    const value = calendarStorageValue(info.start, info.allDay);
    const timeEstimate = info.allDay
      ? undefined
      : Math.max(
          1,
          Math.round((info.end.getTime() - info.start.getTime()) / 60_000),
        );
    onSelect(date, value);
    onCreate(date, value, timeEstimate);
    info.view.calendar.unselect();
  }

  return (
    <div className={`full-calendar-view${listMode ? " is-agenda" : ""}`}>
      <div className="full-calendar-commandbar">
        <div className="full-calendar-navigation">
          <button
            aria-label="Previous period"
            type="button"
            onClick={() => api()?.prev()}
          >
            <ChevronLeft aria-hidden="true" size={19} />
          </button>
          <button
            className="full-calendar-create"
            type="button"
            onClick={() => onCreate(selected, selectedCreateValue)}
          >
            <Plus aria-hidden="true" size={16} />
            Add task
          </button>
          <button type="button" onClick={() => api()?.today()}>
            Today
          </button>
          <button
            aria-label="Next period"
            type="button"
            onClick={() => api()?.next()}
          >
            <ChevronRight aria-hidden="true" size={19} />
          </button>
        </div>
        <h2 aria-live="polite">{title}</h2>
        <div className="full-calendar-modes" aria-label="Calendar layout">
          {calendarModes.map(({ value, label, compact }) => (
            <button
              aria-pressed={mode === value}
              className={compact ? undefined : "wide-mode"}
              key={value}
              type="button"
              onClick={() => changeMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {mutationError ? (
        <p className="inline-error" role="alert">
          The calendar change could not be saved. {mutationError}
        </p>
      ) : null}
      <div className="full-calendar-workspace">
        <div className="full-calendar-surface">
          <FullCalendar
            allDaySlot={preferences.allDaySlot}
            allDayText="All day"
            dayMaxEvents={3}
            dayCellClassNames={(info) =>
              todayString(info.date) === selected ? ["is-selected-day"] : []
            }
            editable
            eventClick={(info) => openEvent(info, onOpen)}
            eventContent={(info) =>
              calendarEventContent(info, onOpen, (metadata, x, y) =>
                setContextAction({
                  id: Date.now(),
                  metadata,
                  x,
                  y,
                }),
              )
            }
            eventDrop={(info) => void moveEvent(info)}
            eventResizableFromStart
            eventResize={(info) => void resizeEvent(info)}
            events={events}
            eventTimeFormat={calendarEventTimeFormat(preferences.hourFormat)}
            firstDay={preferences.firstDay}
            headerToolbar={false}
            height="auto"
            initialDate={selected}
            initialView={initialMode}
            nowIndicator={preferences.nowIndicator}
            noEventsText="No tasks in this period."
            plugins={[
              dayGridPlugin,
              timeGridPlugin,
              listPlugin,
              interactionPlugin,
            ]}
            ref={calendarRef}
            selectable
            select={(info) => createFromSelection(info)}
            selectMirror
            slotDuration={preferences.slotDuration}
            slotMaxTime={preferences.slotMaxTime}
            slotMinTime={preferences.slotMinTime}
            slotLabelFormat={calendarEventTimeFormat(preferences.hourFormat)}
            weekends={preferences.weekends}
            views={{
              timeGridThreeDay: {
                type: "timeGrid",
                duration: {
                  days: numberOption(
                    execution.view.presentation?.options.customDayCount,
                    3,
                  ),
                },
              },
              listWeek: {
                type: "list",
                duration: {
                  days: numberOption(
                    execution.view.presentation?.options.listDayCount,
                    7,
                  ),
                },
              },
            }}
            dateClick={(info: DateClickArg) =>
              onSelect(
                info.dateStr.slice(0, 10),
                calendarStorageValue(info.date, info.allDay),
              )
            }
            datesSet={(info: DatesSetArg) => {
              setTitle(info.view.title);
              setMode(calendarMode(info.view.type));
              setRange({
                start: new Date(info.start.getTime()),
                end: new Date(info.end.getTime() - 1),
              });
            }}
          />
        </div>
        {!listMode ? (
          <aside className="full-calendar-inspector" aria-label="Selected day">
            <header>
              <h2>{agendaLabel(selected)}</h2>
              <span>
                {selectedEntries.length}{" "}
                {selectedEntries.length === 1 ? "task" : "tasks"}
              </span>
            </header>
            {selectedEntries.length ? (
              <div className="full-calendar-day-tasks">
                {selectedEntries.map((entry) => (
                  <TaskRow
                    key={entry.occurrence?.key ?? entry.task.id}
                    details={viewPropertyDetails(
                      entry.row,
                      execution.view.properties,
                      {
                        identityProperty: titleProperty,
                        occurrence: entry.occurrence,
                      },
                    )}
                    occurrence={entry.occurrence}
                    task={entry.task}
                    onOpen={onOpen}
                    onToggle={onToggle}
                  />
                ))}
              </div>
            ) : (
              <p>No tasks on this day. Use Add task to schedule one.</p>
            )}
          </aside>
        ) : null}
      </div>
      {contextAction ? (
        <TaskActions
          contextMenuRequest={contextAction}
          occurrenceDate={contextAction.metadata.occurrence?.date}
          task={contextAction.metadata.entry.task}
          onArchived={() => setContextAction(null)}
          onDeleted={() => setContextAction(null)}
          onOpen={onOpen}
          onToggle={onToggle}
        />
      ) : null}
    </div>
  );
}

const calendarModes: Array<{
  value: CalendarMode;
  label: string;
  compact: boolean;
}> = [
  { value: "dayGridMonth", label: "Month", compact: true },
  { value: "timeGridWeek", label: "Week", compact: false },
  { value: "timeGridThreeDay", label: "3 days", compact: true },
  { value: "timeGridDay", label: "Day", compact: false },
  { value: "listWeek", label: "Agenda", compact: true },
];

function fullCalendarEvents(
  entries: Map<string, CalendarEntry[]>,
  execution: TaskViewExecution,
  titleProperty: string,
): EventInput[] {
  const result: EventInput[] = [];
  for (const [date, values] of entries) {
    for (const entry of values) {
      const displayed = entry.occurrence
        ? occurrenceTask(entry.occurrence)
        : entry.task;
      const scheduled =
        displayed.scheduled && taskDatePart(displayed.scheduled) === date
          ? displayed.scheduled
          : undefined;
      const due =
        displayed.due && taskDatePart(displayed.due) === date
          ? displayed.due
          : undefined;
      const start = scheduled ?? due ?? date;
      const dateField = scheduled ? "scheduled" : "due";
      const allDay = !start.includes("T");
      const editable = !entry.occurrence && !entry.task.recurrence;
      const details =
        viewPropertyDetails(entry.row, execution.view.properties, {
          identityProperty: titleProperty,
          occurrence: entry.occurrence,
        }) ?? [];
      result.push({
        id: [entry.occurrence?.key ?? entry.task.id, dateField, date].join(":"),
        title: entry.task.title,
        start,
        ...(allDay || !displayed.timeEstimate
          ? {}
          : { end: addMinutes(start, displayed.timeEstimate) }),
        allDay,
        editable,
        startEditable: editable,
        durationEditable: editable && !allDay,
        classNames: [
          "task-calendar-event",
          displayed.completed ? "is-complete" : "",
          entry.occurrence ? "is-recurring" : "",
        ].filter(Boolean),
        extendedProps: {
          metadata: {
            entry,
            dateField,
            occurrence: entry.occurrence,
          } satisfies CalendarEventMetadata,
          tone: eventTone(displayed),
          details,
        },
      });
    }
  }
  return result;
}

function calendarEventContent(
  info: EventContentArg,
  onOpen: (task: Task, occurrenceDate?: string) => void,
  onContextAction: (
    metadata: CalendarEventMetadata,
    x: number,
    y: number,
  ) => void,
) {
  const tone = String(info.event.extendedProps.tone ?? "var(--accent)");
  const details = eventDetails(info.event.extendedProps.details);
  const metadata = eventMetadata(info.event.extendedProps);
  return (
    <span
      aria-label={calendarEventLabel(info)}
      className={`full-calendar-event-content${info.event.extendedProps.metadata?.occurrence ? " is-recurring" : ""}`}
      role="button"
      style={{ "--event-tone": tone } as React.CSSProperties}
      tabIndex={0}
      onContextMenu={(event) => {
        if (!metadata) return;
        event.preventDefault();
        event.stopPropagation();
        onContextAction(metadata, event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (
          metadata &&
          (event.key === "ContextMenu" ||
            (event.key === "F10" && event.shiftKey))
        ) {
          event.preventDefault();
          const bounds = event.currentTarget.getBoundingClientRect();
          onContextAction(metadata, bounds.left + 16, bounds.top + 16);
          return;
        }
        if (metadata && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen(metadata.entry.task, metadata.occurrence?.date);
        }
      }}
    >
      <span className="full-calendar-event-primary">
        <i aria-hidden="true" />
        {info.timeText ? <time>{info.timeText}</time> : null}
        <span>{info.event.title}</span>
      </span>
      {details.length ? (
        <span className="full-calendar-event-properties">
          {details.map((detail) => (
            <span key={detail.key} title={detail.description}>
              <span>{detail.label}</span>
              <strong>{detail.value}</strong>
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function calendarEventLabel(info: EventContentArg): string {
  const start = info.event.start;
  if (!start) return info.event.title;
  const date =
    todayString(start) === todayString()
      ? "Today"
      : new Intl.DateTimeFormat(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        }).format(start);
  const time = info.event.allDay
    ? ""
    : `, ${new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(start)}`;
  return `${info.event.title} ${date}${time}`;
}

function eventDetails(value: unknown): ViewPropertyDetail[] {
  return Array.isArray(value)
    ? value.filter((detail): detail is ViewPropertyDetail =>
        Boolean(
          detail &&
          typeof detail === "object" &&
          typeof detail.key === "string" &&
          typeof detail.label === "string" &&
          typeof detail.value === "string",
        ),
      )
    : [];
}

function openEvent(
  info: EventClickArg,
  onOpen: (task: Task, occurrenceDate?: string) => void,
) {
  const metadata = eventMetadata(info.event.extendedProps);
  if (metadata) onOpen(metadata.entry.task, metadata.occurrence?.date);
}

function eventMetadata(
  extendedProps: Record<string, unknown>,
): CalendarEventMetadata | undefined {
  const value = extendedProps.metadata;
  return value && typeof value === "object"
    ? (value as CalendarEventMetadata)
    : undefined;
}

function calendarMode(value: unknown): CalendarMode {
  return calendarModes.some((mode) => mode.value === value)
    ? (value as CalendarMode)
    : "dayGridMonth";
}

function initialRange(
  selected: string,
  mode: CalendarMode,
): { start: Date; end: Date } {
  const date = dateFromStorage(selected) ?? new Date();
  if (mode === "dayGridMonth") {
    return {
      start: new Date(date.getFullYear(), date.getMonth(), -7),
      end: new Date(date.getFullYear(), date.getMonth() + 1, 14),
    };
  }
  return {
    start: new Date(date.getFullYear(), date.getMonth(), date.getDate() - 7),
    end: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 14),
  };
}

function addMinutes(value: string, minutes: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setMinutes(date.getMinutes() + minutes);
  return calendarStorageValue(date, false);
}

function calendarStorageValue(date: Date, allDay: boolean): string {
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  if (allDay) return day;
  return `${day}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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

function eventTone(task: Task): string {
  if (task.completed) return "var(--ink-muted)";
  if (task.priority === "high") return "var(--danger)";
  if (task.priority === "low") return "var(--success)";
  return "var(--accent)";
}

function numberOption(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

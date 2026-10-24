import "@tasknotes/calendar/calendar.css";

import { TaskCalendar } from "@tasknotes/calendar/react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { TaskActions } from "../components/task-actions";
import { useCalendarOverflow } from "./use-calendar-overflow";
import {
  calendarEntryKind,
  calendarPriorityLegend,
  calendarPriorityMarker,
  withPendingMoves,
  withPriorityDetail,
  type CalendarPriorityMarker,
  type PendingCalendarMove,
} from "./calendar-event-presentation";
import { TaskRow } from "../components/task-row";
import {
  calendarEntryKey,
  calendarEvents,
  type CalendarEntry,
} from "../domain/calendar-events";
import type { RecurringCalendarDrop } from "../domain/calendar-recurrence-drag";
import {
  moveCalendarTimeEntry,
  resizeCalendarTimeEntry,
} from "../domain/calendar-time-entries";
import { occurrenceTask, type TaskOccurrence } from "../domain/task-occurrence";
import { dateFromStorage, taskDatePart, todayString } from "../domain/task";
import {
  relativeDateDetail,
  viewPropertyDetails,
  type ViewPropertyDetail,
} from "../domain/view-values";
import { useRepository } from "./repository-context";
import type {
  CalendarHourFormat,
  CalendarPreferences,
} from "./calendar-preferences";

import type {
  Calendar,
  CalendarItem,
  ItemArg,
  ItemChangeArg,
  SelectArg,
  ViewInfo,
  ViewType,
} from "@tasknotes/calendar";
import type {
  TaskSummary,
  TaskTimeEntry,
  UpdateTaskInput,
} from "../domain/task";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskViewExecution } from "../domain/view";

/** View names as stored in `.base` files, shared with the TaskNotes plugin. */
type CalendarMode =
  | "dayGridMonth"
  | "timeGridWeek"
  | "timeGridThreeDay"
  | "timeGridDay"
  | "listWeek";

interface CalendarEventMetadata {
  entry: CalendarEntry;
  dateField?: "scheduled" | "due";
  occurrence?: TaskOccurrence;
  timeEntryIndex?: number;
}

/** What an entry draws; kept small so the calendar can compare it cheaply. */
interface CalendarEventPresentation {
  marker?: CalendarPriorityMarker;
  details: (ViewPropertyDetail & { overdue?: boolean })[];
  kind?: string;
  recurring: boolean;
}

type TaskCalendarItem = CalendarItem<CalendarEventPresentation>;

const PHONE_QUERY = "(max-width: 839px)";

export function TaskCalendarView({
  execution,
  preferences,
  identityTasks,
  selected,
  selectedCreateValue,
  titleProperty,
  onSelect,
  onCreate,
  onOpen: onOpenTask,
  onToggle,
  onUpdate,
  onUpdateOccurrence,
  onReplaceTimeEntries,
}: {
  execution: TaskViewExecution;
  preferences: CalendarPreferences;
  identityTasks: readonly TaskSummary[];
  selected: string;
  selectedCreateValue: string;
  titleProperty: string;
  onSelect(date: string, createValue?: string): void;
  onCreate(date: string, createValue?: string, timeEstimate?: number): void;
  onOpen(task: TaskSummary, occurrenceDate?: string): void;
  onToggle(task: TaskSummary, occurrenceDate?: string): void;
  onUpdate(task: TaskSummary, input: UpdateTaskInput): Promise<void>;
  onUpdateOccurrence(
    task: TaskSummary,
    drop: RecurringCalendarDrop,
  ): Promise<void>;
  onReplaceTimeEntries(
    task: TaskSummary,
    entries: TaskTimeEntry[],
  ): Promise<void>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeOverflow = useCalendarOverflow(rootRef);
  function onOpen(task: TaskSummary, occurrenceDate?: string) {
    closeOverflow();
    onOpenTask(task, occurrenceDate);
  }
  const calendarRef = useRef<Calendar<CalendarEventPresentation> | null>(null);
  const [initialDate] = useState(selected);
  const [mode, setMode] = useState<CalendarMode>(() =>
    calendarMode(execution.view.presentation?.options.calendarView),
  );
  const phone = useMediaQuery(PHONE_QUERY);
  const phoneMonth = phone && mode === "dayGridMonth";
  const [title, setTitle] = useState("");
  const [range, setRange] = useState(() => initialRange(selected, mode));
  const [mutationError, setMutationError] = useState("");
  const [contextAction, setContextAction] = useState<{
    id: number;
    metadata: CalendarEventMetadata;
    x: number;
    y: number;
  } | null>(null);
  const entries = useMemo(
    () =>
      calendarEvents(execution, range.start, range.end, identityTasks, {
        showTimeEntries: preferences.showTimeEntries,
      }),
    [execution, identityTasks, preferences.showTimeEntries, range],
  );
  const { configuration } = useRepository();
  const [pendingMoves, setPendingMoves] = useState<
    ReadonlyMap<string, PendingCalendarMove>
  >(() => new Map());
  const executionRef = useRef(execution);
  useEffect(() => {
    executionRef.current = execution;
  }, [execution]);
  const built = useMemo(
    () => calendarItems(entries, execution, titleProperty, configuration),
    [configuration, entries, execution, titleProperty],
  );
  // Handlers read the latest task records by id; the calendar keeps an item
  // object for as long as what it draws is unchanged.
  const metadataRef = useRef(built.metadata);
  useEffect(() => {
    metadataRef.current = built.metadata;
  }, [built]);
  const items = useMemo(
    () => withPendingMoves(built.items, pendingMoves, execution),
    [built, execution, pendingMoves],
  );
  const legend = useMemo(
    () =>
      calendarPriorityLegend(
        built.items.map((item) => item.data?.marker),
        configuration,
      ),
    [built, configuration],
  );
  const selectedEntries = (entries.get(selected) ?? []).filter(
    (entry) => !entry.timeEntry,
  );
  const listMode = mode === "listWeek";

  // Rows name an elevated priority so the grid's coloured marks read the
  // same here; without view properties the row's defaults already do.
  function inspectorDetails(entry: CalendarEntry) {
    const details = viewPropertyDetails(entry.row, execution.view.properties, {
      identityProperty: titleProperty,
      occurrence: entry.occurrence,
    });
    if (!details) return undefined;
    const displayed = entry.occurrence
      ? occurrenceTask(entry.occurrence)
      : entry.task;
    return withPriorityDetail(
      details,
      calendarPriorityMarker(displayed, configuration),
      configuration,
    );
  }

  function holdMove(id: string, move: PendingCalendarMove | undefined) {
    setPendingMoves((current) => {
      // Drop moves that later view data has already superseded.
      const next = new Map(
        [...current].filter(
          ([, held]) =>
            !held.settledWith || held.settledWith === executionRef.current,
        ),
      );
      if (move) next.set(id, move);
      else next.delete(id);
      return next;
    });
  }

  async function moveEvent(info: ItemChangeArg<CalendarEventPresentation>) {
    const metadata = metadataRef.current.get(info.item.id);
    if (!metadata) {
      info.revert();
      return;
    }
    setMutationError("");
    const id = info.item.id;
    const timeEntry = metadata.timeEntryIndex !== undefined;
    const move: PendingCalendarMove = {
      start: info.startStr,
      // Untimed tasks and open time entries keep their implicit length.
      ...(info.item.end ? { end: info.endStr } : {}),
      allDay: info.allDay,
    };
    holdMove(id, move);
    try {
      if (timeEntry) {
        await onReplaceTimeEntries(
          metadata.entry.task,
          moveCalendarTimeEntry(
            metadata.entry.task.timeEntries,
            metadata.timeEntryIndex!,
            info.start,
            info.item.end ? info.end : null,
          ),
        );
        holdMove(id, { ...move, settledWith: executionRef.current });
        return;
      }
      if (!metadata.dateField) throw new Error("The task date is unavailable.");
      if (metadata.occurrence)
        await onUpdateOccurrence(metadata.entry.task, {
          occurrenceDate: metadata.occurrence.date,
          recurringKind: metadata.entry.recurringKind ?? "pattern",
          dateField: metadata.dateField,
          start: info.start,
          allDay: info.allDay,
        });
      else
        await onUpdate(metadata.entry.task, {
          [metadata.dateField]: info.startStr,
        });
      holdMove(id, { ...move, settledWith: executionRef.current });
    } catch (reason) {
      holdMove(id, undefined);
      info.revert();
      setMutationError(message(reason));
    }
  }

  async function resizeEvent(info: ItemChangeArg<CalendarEventPresentation>) {
    const metadata = metadataRef.current.get(info.item.id);
    if (!metadata || info.allDay) {
      info.revert();
      return;
    }
    const minutes = Math.max(
      1,
      Math.round((info.end.getTime() - info.start.getTime()) / 60_000),
    );
    setMutationError("");
    if (metadata.occurrence && metadata.timeEntryIndex === undefined) {
      info.revert();
      return;
    }
    const id = info.item.id;
    const move: PendingCalendarMove = {
      start: info.startStr,
      end: info.endStr,
      allDay: false,
    };
    holdMove(id, move);
    try {
      if (metadata.timeEntryIndex !== undefined)
        await onReplaceTimeEntries(
          metadata.entry.task,
          info.delta
            ? moveCalendarTimeEntry(
                metadata.entry.task.timeEntries,
                metadata.timeEntryIndex,
                info.start,
                info.end,
              )
            : resizeCalendarTimeEntry(
                metadata.entry.task.timeEntries,
                metadata.timeEntryIndex,
                info.end,
              ),
        );
      else
        await onUpdate(metadata.entry.task, {
          // Resizing from the top moves the start as well as the length.
          ...(info.delta && metadata.dateField
            ? { [metadata.dateField]: info.startStr }
            : {}),
          timeEstimate: minutes,
        });
      holdMove(id, { ...move, settledWith: executionRef.current });
    } catch (reason) {
      holdMove(id, undefined);
      info.revert();
      setMutationError(message(reason));
    }
  }

  function createFromSelection(info: SelectArg) {
    const date = info.startStr.slice(0, 10);
    const timeEstimate = info.allDay
      ? undefined
      : Math.max(
          1,
          Math.round((info.end.getTime() - info.start.getTime()) / 60_000),
        );
    onSelect(date, info.startStr);
    // On phones a day tap browses its tasks; a timed selection still starts capture.
    if (!info.allDay || !window.matchMedia?.(PHONE_QUERY).matches) {
      onCreate(date, info.startStr, timeEstimate);
    }
    calendarRef.current?.unselect();
  }

  function openContextActions({
    item,
    el,
    jsEvent,
  }: ItemArg<CalendarEventPresentation> & {
    jsEvent: MouseEvent | KeyboardEvent;
  }) {
    const metadata = metadataRef.current.get(item.id);
    if (!metadata) return;
    let x: number;
    let y: number;
    if ("clientX" in jsEvent && jsEvent.type === "contextmenu") {
      x = jsEvent.clientX;
      y = jsEvent.clientY;
    } else {
      const bounds = el.getBoundingClientRect();
      x = bounds.left + 16;
      y = bounds.top + 16;
    }
    setContextAction({ id: Date.now(), metadata, x, y });
  }

  return (
    <div
      ref={rootRef}
      className={`full-calendar-view${listMode ? " is-agenda" : ""}`}
    >
      <div className="full-calendar-workspace">
        {/* The layout switcher belongs to the calendar it changes, so it sits
            on the date row above the grid or agenda on every screen. */}
        <div className="full-calendar-main">
          <div className="full-calendar-commandbar">
            <div className="full-calendar-navigation">
              <button
                aria-label="Previous period"
                type="button"
                onClick={() => calendarRef.current?.prev()}
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
              <button
                type="button"
                onClick={() => calendarRef.current?.goToday()}
              >
                Today
              </button>
              <button
                aria-label="Next period"
                type="button"
                onClick={() => calendarRef.current?.next()}
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
                  onClick={() => setMode(value)}
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
          <div className="full-calendar-surface">
            <TaskCalendar<CalendarEventPresentation>
              calendarRef={(calendar) => {
                calendarRef.current = calendar;
              }}
              items={items}
              // Day highlights and phone dots are drawn by render hooks.
              renderKey={`${selected}|${phoneMonth}`}
              view={calendarView(mode)}
              date={initialDate}
              dayCount={numberOption(
                execution.view.presentation?.options.customDayCount,
                3,
              )}
              listDayCount={numberOption(
                execution.view.presentation?.options.listDayCount,
                7,
              )}
              toolbar={false}
              height="auto"
              navLinks={false}
              editable
              selectable
              selectMirror
              resizableFromStart
              allDaySlot={preferences.allDaySlot}
              firstDay={preferences.firstDay}
              weekends={preferences.weekends}
              nowIndicator={preferences.nowIndicator}
              hour12={hour12(preferences.hourFormat)}
              slotDuration={preferences.slotDuration}
              slotMinTime={preferences.slotMinTime}
              slotMaxTime={preferences.slotMaxTime}
              eventMinHeight={28}
              // Phone months draw every task as a dot and list the selected
              // day below, so there is no More popover to open.
              dayMaxEvents={phoneMonth ? false : 3}
              text={{
                allDay: "All day",
                noItems: "No tasks in this period.",
              }}
              dayClassNames={({ dateStr }) =>
                dateStr === selected ? ["is-selected-day"] : []
              }
              dayHeaderContent={({ date, view }) =>
                view.type === "list" ? listDayLabel(date) : null
              }
              itemClassNames={() => (phoneMonth ? ["is-indicator"] : [])}
              itemContent={(arg) =>
                calendarEventContent(
                  arg,
                  configuration,
                  preferences,
                  phoneMonth,
                )
              }
              listItemContent={(arg) =>
                calendarEventContent(arg, configuration, preferences, false)
              }
              itemDidMount={(arg) =>
                describeEvent(arg, configuration, phoneMonth)
              }
              onItemClick={({ item }) => {
                const metadata = metadataRef.current.get(item.id);
                if (metadata)
                  onOpen(metadata.entry.task, metadata.occurrence?.date);
              }}
              onItemContextMenu={(arg) => openContextActions(arg)}
              onItemDrop={(info) => void moveEvent(info)}
              onItemResize={(info) => void resizeEvent(info)}
              onSelect={createFromSelection}
              onDateClick={({ dateStr }) => onSelect(dateStr, dateStr)}
              onRangeChange={(view: ViewInfo) => {
                setTitle(view.title);
                setRange({
                  start: new Date(view.range.start.getTime()),
                  end: new Date(view.range.end.getTime() - 1),
                });
              }}
            />
          </div>
          {legend.length && !listMode ? (
            <ul className="full-calendar-legend" aria-label="Calendar markers">
              {legend.map((marker) => (
                <li
                  key={marker.value}
                  style={
                    { "--event-tone": marker.color } as React.CSSProperties
                  }
                >
                  <i aria-hidden="true" />
                  {marker.label}
                </li>
              ))}
            </ul>
          ) : null}
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
                    key={calendarEntryKey(entry)}
                    details={inspectorDetails(entry)}
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
  view: ViewType;
  label: string;
  compact: boolean;
}> = [
  { value: "dayGridMonth", view: "month", label: "Month", compact: true },
  { value: "timeGridWeek", view: "week", label: "Week", compact: false },
  { value: "timeGridThreeDay", view: "days", label: "3 days", compact: true },
  { value: "timeGridDay", view: "day", label: "Day", compact: false },
  { value: "listWeek", view: "list", label: "Agenda", compact: true },
];

function calendarView(mode: CalendarMode): ViewType {
  return calendarModes.find((option) => option.value === mode)?.view ?? "month";
}

function calendarItems(
  entries: Map<string, CalendarEntry[]>,
  execution: TaskViewExecution,
  titleProperty: string,
  configuration: TaskCollectionConfiguration,
): {
  items: TaskCalendarItem[];
  metadata: Map<string, CalendarEventMetadata>;
} {
  const items: TaskCalendarItem[] = [];
  const metadata = new Map<string, CalendarEventMetadata>();
  for (const [date, values] of entries) {
    for (const entry of values) {
      if (entry.timeEntry && entry.timeEntryIndex !== undefined) {
        const start = new Date(entry.timeEntry.startTime);
        const recordedEnd = entry.timeEntry.endTime
          ? new Date(entry.timeEntry.endTime)
          : null;
        const liveEnd = new Date();
        const end =
          recordedEnd && recordedEnd > start
            ? recordedEnd
            : liveEnd > start
              ? liveEnd
              : new Date(start.getTime() + 60_000);
        const id = calendarEntryKey(entry);
        metadata.set(id, { entry, timeEntryIndex: entry.timeEntryIndex });
        items.push({
          id,
          title: entry.timeEntry.description
            ? `${entry.task.title}: ${entry.timeEntry.description}`
            : entry.task.title,
          start: entry.timeEntry.startTime,
          end: end.toISOString(),
          allDay: false,
          kind: "time-entry",
          color: "var(--success)",
          editable: true,
          startEditable: true,
          durationEditable: Boolean(entry.timeEntry.endTime),
          className: ["task-calendar-event", "is-time-entry"],
          data: { details: [], kind: "Tracked time", recurring: false },
        });
        continue;
      }
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
      const editable = entry.occurrence
        ? !entry.occurrence.completed && !entry.occurrence.skipped
        : !entry.task.recurrence;
      const marker = calendarPriorityMarker(displayed, configuration);
      const details = withPriorityDetail(
        viewPropertyDetails(entry.row, execution.view.properties, {
          identityProperty: titleProperty,
          occurrence: entry.occurrence,
        }) ?? [],
        marker,
        configuration,
      ).map((detail) => relativeDateDetail(detail, displayed, configuration));
      const id = [calendarEntryKey(entry), dateField, date].join(":");
      metadata.set(id, {
        entry,
        dateField,
        occurrence: entry.occurrence,
      });
      items.push({
        id,
        title: entry.task.title,
        start,
        ...(allDay || !displayed.timeEstimate
          ? {}
          : { end: addMinutes(start, displayed.timeEstimate) }),
        allDay,
        kind: "task",
        completed: displayed.completed,
        editable,
        startEditable: editable,
        durationEditable: editable && !entry.occurrence && !allDay,
        className: [
          "task-calendar-event",
          displayed.completed ? "is-complete" : "",
          entry.occurrence ? "is-recurring" : "",
          entry.recurringKind === "next-scheduled" ? "is-recurring-next" : "",
          entry.recurringKind === "pattern" ? "is-recurring-pattern" : "",
        ].filter(Boolean),
        data: {
          ...(marker ? { marker } : {}),
          details,
          // A task can appear on its scheduled and its due day; name the
          // reason on the due-day entry so the repeat is not a mystery.
          ...(dateField === "due" && displayed.scheduled
            ? { kind: "Due" }
            : {}),
          recurring: Boolean(entry.occurrence),
        },
      });
    }
  }
  return { items, metadata };
}

function variantOf(el: HTMLElement): "timed" | "bar" | "dot" | "list" {
  if (el.classList.contains("tnc-item--timed")) return "timed";
  if (el.classList.contains("tnc-item--list")) return "list";
  if (el.classList.contains("tnc-item--dot")) return "dot";
  return "bar";
}

function calendarEventContent(
  { item, el }: ItemArg<CalendarEventPresentation>,
  configuration: TaskCollectionConfiguration,
  preferences: CalendarPreferences,
  phoneMonth: boolean,
): Node {
  const doc = el.ownerDocument;
  const presentation = item.data;
  const marker = presentation?.marker;
  const node = (tag: string, className?: string, text?: string) => {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const content = node(
    "span",
    [
      "full-calendar-event-content",
      presentation?.recurring ? "is-recurring" : "",
      marker ? "has-marker" : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (marker) content.style.setProperty("--event-tone", marker.color);
  const primary = node("span", "full-calendar-event-primary");
  content.append(primary);
  if (phoneMonth) {
    // Every task is a dot here; only an elevated priority colours it.
    content.setAttribute("aria-hidden", "true");
    primary.append(node("i"));
    return content;
  }
  const variant = variantOf(el);
  const listView = variant === "list";
  const details = presentation?.details ?? [];
  const kind = calendarEntryKind(
    presentation?.kind,
    details,
    listView,
    configuration,
  );
  const timeText = eventTimeText(item, variant, preferences.hourFormat);
  // Agenda rows name the priority in their details instead.
  if (marker && !listView) primary.append(node("i"));
  if (timeText && !listView) primary.append(node("time", undefined, timeText));
  if (kind) primary.append(node("em", "full-calendar-event-kind", kind));
  primary.append(node("span", undefined, item.title));
  if (details.length) {
    const properties = node("span", "full-calendar-event-properties");
    for (const detail of details) {
      const part = node("span", detail.overdue ? "is-overdue" : undefined);
      if (detail.description) part.title = detail.description;
      part.append(
        node("span", undefined, detail.label),
        node("strong", undefined, detail.value),
      );
      properties.append(part);
    }
    content.append(properties);
  }
  if (!listView) return content;
  const fragment = doc.createDocumentFragment();
  // All-day tasks lead each date without a per-row label; only timed tasks
  // carry a time.
  fragment.append(node("time", "full-calendar-event-time", timeText), content);
  return fragment;
}

/** Names the entry for assistive technology, or hides a phone-month dot. */
function describeEvent(
  { item, el }: ItemArg<CalendarEventPresentation>,
  configuration: TaskCollectionConfiguration,
  phoneMonth: boolean,
) {
  el.dataset.date = calendarDay(item.start);
  if (phoneMonth) {
    // Phone month dots are indicators; the day list holds the tasks.
    el.tabIndex = -1;
    el.removeAttribute("role");
    el.removeAttribute("aria-label");
    el.setAttribute("aria-hidden", "true");
    return;
  }
  const presentation = item.data;
  const marker = presentation?.marker;
  const kind = calendarEntryKind(
    presentation?.kind,
    presentation?.details ?? [],
    variantOf(el) === "list",
    configuration,
  );
  el.setAttribute(
    "aria-label",
    `${kind ? `${kind}: ` : ""}${calendarEventLabel(item)}${marker ? `, ${marker.label.toLowerCase()}` : ""}`,
  );
  if (marker) el.title = marker.label;
}

function eventTimeText(
  item: TaskCalendarItem,
  variant: ReturnType<typeof variantOf>,
  hourFormat: CalendarHourFormat,
): string {
  if (item.allDay) return "";
  const start = new Date(item.start);
  if (Number.isNaN(start.getTime())) return "";
  const format = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: hour12(hourFormat),
  });
  const end = item.end ? new Date(item.end) : null;
  return (variant === "timed" || variant === "list") &&
    end &&
    !Number.isNaN(end.getTime())
    ? format.formatRange(start, end)
    : format.format(start);
}

function hour12(preference: CalendarHourFormat): boolean | undefined {
  return preference === "12" ? true : preference === "24" ? false : undefined;
}

function calendarDay(value: TaskCalendarItem["start"]): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value))
    return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : todayString(date);
}

function calendarEventLabel(item: TaskCalendarItem): string {
  const start = new Date(item.start);
  if (Number.isNaN(start.getTime())) return item.title;
  const date =
    todayString(start) === todayString()
      ? "Today"
      : new Intl.DateTimeFormat(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        }).format(start);
  const time = item.allDay
    ? ""
    : `, ${new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(start)}`;
  return `${item.title} ${date}${time}`;
}

function listDayLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia?.(query).matches ?? false,
  );
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
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
  return `${todayString(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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

function numberOption(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

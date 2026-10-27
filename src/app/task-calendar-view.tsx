import "@tasknotes/calendar/calendar.css";
import { t } from "@lingui/core/macro";
import { useLingui, Trans } from "@lingui/react/macro";
import { appLocale } from "../i18n/app";
import { calendarText } from "../i18n/calendar-locale";
import { countLabel } from "../i18n/default-labels";

import { TaskCalendar } from "@tasknotes/calendar/react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  calendarItems,
  type CalendarEventData,
  type CalendarEventMetadata,
  type TaskCalendarItem,
} from "./calendar-items";
import { TaskActions } from "../components/task-actions";
import { useCalendarOverflow } from "./use-calendar-overflow";
import {
  calendarEntryKind,
  calendarPriorityLegend,
  calendarPriorityMarker,
  withPendingMoves,
  withPriorityDetail,
  type PendingCalendarMove,
} from "./calendar-event-presentation";
import { TaskRow } from "../components/task-row";
import {
  calendarEntryKey,
  type CalendarEntry,
} from "../domain/calendar-events";
import {
  calendarOccurrenceChoice,
  type CalendarTaskEdit,
} from "../domain/calendar-edit";
import type { CalendarOccurrenceChoice } from "@tasknotes/model/calendar";
import {
  RecurringEditScopeDialog,
  type RecurringEditScope,
  type RecurringEditScopeRequest,
} from "../components/recurring-edit-scope-dialog";
import { formatOccurrenceDate } from "./task-editor-draft";
import { occurrenceTask } from "../domain/task-occurrence";
import { dateFromStorage, todayString } from "../domain/task";
import { viewPropertyDetails } from "../i18n/view-presentation";
import { useRepository } from "./repository-context";
import type {
  CalendarHourFormat,
  CalendarPreferences,
} from "./calendar-preferences";

import type {
  Calendar,
  DateClickArg,
  ItemArg,
  ItemChangeArg,
  SelectArg,
  ViewInfo,
  ViewType,
} from "@tasknotes/calendar";
import type { TaskSummary } from "../domain/task";
import { useCalendarEntries } from "./use-calendar-entries";
import { calendarContext } from "../domain/calendar-events";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskViewExecution } from "../domain/view";

/** View names as stored in `.base` files, shared with the TaskNotes plugin. */
type CalendarMode =
  | "dayGridMonth"
  | "timeGridWeek"
  | "timeGridThreeDay"
  | "timeGridDay"
  | "listWeek";

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
  onEdit,
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
  onEdit(task: TaskSummary, edit: CalendarTaskEdit): Promise<void>;
}) {
  const { t } = useLingui();
  const locale = appLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const closeOverflow = useCalendarOverflow(rootRef);
  function onOpen(task: TaskSummary, occurrenceDate?: string) {
    closeOverflow();
    onOpenTask(task, occurrenceDate);
  }
  const calendarRef = useRef<Calendar<CalendarEventData> | null>(null);
  const [initialDate] = useState(selected);
  const [mode, setMode] = useState<CalendarMode>(() =>
    calendarMode(execution.view.presentation?.options.calendarView),
  );
  const phone = useMediaQuery(PHONE_QUERY);
  const phoneMonth = phone && mode === "dayGridMonth";
  const [title, setTitle] = useState("");
  // The external calendar updates its title on a language change without
  // emitting onRangeChange when the visible dates stay the same.
  useEffect(() => {
    const view = calendarRef.current?.getView();
    if (view) setTitle(view.title);
  }, [locale]);
  const [range, setRange] = useState(() => initialRange(selected, mode));
  const [mutationError, setMutationError] = useState("");
  const [contextAction, setContextAction] = useState<{
    id: number;
    metadata: CalendarEventMetadata;
    x: number;
    y: number;
  } | null>(null);
  const { configuration, materializeOccurrence } = useRepository();
  const { timezone } = calendarContext();
  const [scopeRequest, setScopeRequest] = useState<
    | (RecurringEditScopeRequest & {
        resolve(scope: RecurringEditScope | null): void;
      })
    | null
  >(null);
  const display = useMemo(
    () => ({
      showTimeEntries: preferences.showTimeEntries,
      showAllDaySlot: preferences.allDaySlot,
      calendarView: mode,
    }),
    [preferences.showTimeEntries, preferences.allDaySlot, mode],
  );
  const entries = useCalendarEntries(
    execution,
    range,
    identityTasks,
    configuration,
    display,
  );
  const [pendingMoves, setPendingMoves] = useState<
    ReadonlyMap<string, PendingCalendarMove>
  >(() => new Map());
  const executionRef = useRef(execution);
  useEffect(() => {
    executionRef.current = execution;
  }, [execution]);
  const built = useMemo(
    () => ({
      ...calendarItems(entries, execution, titleProperty, configuration),
      locale,
    }),
    [configuration, entries, execution, titleProperty, locale],
  );
  const items = useMemo(
    () =>
      withPendingMoves(built.items, pendingMoves, execution).map(withRevision),
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

  /** Asks about a gesture on a generated occurrence; true unless the person chose the series. */
  async function editedOneOccurrence(
    info: ItemChangeArg<CalendarEventData>,
    metadata: CalendarEventMetadata,
    choice: CalendarOccurrenceChoice,
  ): Promise<boolean> {
    const scope = await new Promise<RecurringEditScope | null>((resolve) =>
      setScopeRequest({
        title: metadata.entry.task.title,
        date: formatOccurrenceDate(choice.occurrence.occurrenceDate),
        series: choice.series,
        resolve,
      }),
    );
    if (scope === "series") return false;
    info.revert();
    if (scope === "occurrence") {
      try {
        await materializeOccurrence(
          metadata.entry.task.id,
          choice.occurrence.occurrenceDate,
          choice.occurrence.overrides,
        );
      } catch (reason) {
        setMutationError(message(reason));
      }
    }
    return true;
  }

  async function moveEvent(info: ItemChangeArg<CalendarEventData>) {
    const metadata = info.item.data?.metadata;
    if (!metadata) {
      info.revert();
      return;
    }
    setMutationError("");
    const id = info.item.id;
    const edit: CalendarTaskEdit = {
      entry: metadata.entry.modelEntry,
      change: {
        kind: "drop",
        start: info.start.toISOString(),
        end: info.end.toISOString(),
        allDay: info.allDay,
      },
      timezone,
    };
    // Other gestures stay synchronous so the moved item holds its place at once.
    const choice = calendarOccurrenceChoice(
      metadata.entry.task,
      edit,
      configuration,
    );
    if (choice && (await editedOneOccurrence(info, metadata, choice))) return;
    const move: PendingCalendarMove = {
      start: info.startStr,
      // Untimed tasks and open time entries keep their implicit length.
      ...(info.item.end ? { end: info.endStr } : {}),
      allDay: info.allDay,
    };
    holdMove(id, move);
    try {
      await onEdit(metadata.entry.task, edit);
      holdMove(id, { ...move, settledWith: executionRef.current });
    } catch (reason) {
      holdMove(id, undefined);
      info.revert();
      setMutationError(message(reason));
    }
  }

  async function resizeEvent(info: ItemChangeArg<CalendarEventData>) {
    const metadata = info.item.data?.metadata;
    if (!metadata) {
      info.revert();
      return;
    }
    setMutationError("");
    const id = info.item.id;
    const edit: CalendarTaskEdit = {
      entry: metadata.entry.modelEntry,
      change: {
        kind: "resize",
        start: info.start.toISOString(),
        end: info.end.toISOString(),
        allDay: info.allDay,
      },
      timezone,
    };
    // Other gestures stay synchronous so the moved item holds its place at once.
    const choice = calendarOccurrenceChoice(
      metadata.entry.task,
      edit,
      configuration,
    );
    if (choice && (await editedOneOccurrence(info, metadata, choice))) return;
    const move: PendingCalendarMove = {
      start: info.startStr,
      end: info.endStr,
      allDay: info.allDay,
    };
    holdMove(id, move);
    try {
      await onEdit(metadata.entry.task, edit);
      holdMove(id, { ...move, settledWith: executionRef.current });
    } catch (reason) {
      holdMove(id, undefined);
      info.revert();
      setMutationError(message(reason));
    }
  }

  function selectDate({ dateStr, startStr, allDay, jsEvent }: DateClickArg) {
    // A slot names its time, so the day's Add task starts there.
    onSelect(dateStr, startStr);
    // Mouse clicks on a slot also select it, which starts capture; a tap on a
    // phone only clicks, so a timed tap starts capture at that time itself.
    if (!allDay && "pointerType" in jsEvent && jsEvent.pointerType === "touch")
      onCreate(dateStr, startStr);
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
  }: ItemArg<CalendarEventData> & {
    jsEvent: MouseEvent | KeyboardEvent;
  }) {
    const metadata = item.data?.metadata;
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
                aria-label={t`Previous period`}
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
                <Trans>Add task</Trans>
              </button>
              <button
                type="button"
                onClick={() => calendarRef.current?.goToday()}
              >
                <Trans>Today</Trans>
              </button>
              <button
                aria-label={t`Next period`}
                type="button"
                onClick={() => calendarRef.current?.next()}
              >
                <ChevronRight aria-hidden="true" size={19} />
              </button>
            </div>
            <h2 aria-live="polite">{title}</h2>
            <div
              className="full-calendar-modes"
              aria-label={t`Calendar layout`}
            >
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
          {scopeRequest ? (
            <RecurringEditScopeDialog
              request={scopeRequest}
              onChoose={(scope) => {
                scopeRequest.resolve(scope);
                setScopeRequest(null);
              }}
            />
          ) : null}
          {mutationError ? (
            <p className="inline-error" role="alert">
              <Trans>The calendar change could not be saved. </Trans>
              {mutationError}
            </p>
          ) : null}
          <div className="full-calendar-surface">
            <TaskCalendar<CalendarEventData>
              calendarRef={(calendar) => {
                calendarRef.current = calendar;
              }}
              items={items}
              timeZone={timezone}
              locale={locale}
              // Selected day and imperative entry labels follow app language.
              renderKey={`${selected}|${built.locale}`}
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
              allDaySlot={
                typeof execution.view.presentation?.options.showAllDaySlot ===
                "boolean"
                  ? execution.view.presentation.options.showAllDaySlot
                  : preferences.allDaySlot
              }
              firstDay={preferences.firstDay}
              weekends={preferences.weekends}
              nowIndicator={preferences.nowIndicator}
              hour12={hour12(preferences.hourFormat)}
              slotDuration={preferences.slotDuration}
              slotMinTime={preferences.slotMinTime}
              slotMaxTime={preferences.slotMaxTime}
              eventMinHeight={28}
              // Phone months draw every task as a dot (the day cell is the
              // target) and list the selected day below.
              monthDisplay={phoneMonth ? "dots" : "full"}
              dayMaxEvents={phoneMonth ? true : 3}
              text={calendarText()}
              dayClassNames={({ dateStr }) =>
                dateStr === selected ? ["is-selected-day"] : []
              }
              dayHeaderContent={({ date, view }) =>
                view.type === "list" ? listDayLabel(date) : null
              }
              itemClassNames={({ item }) =>
                item.data?.marker ? ["has-marker"] : []
              }
              itemContent={(arg) => calendarEventContent(arg, configuration)}
              listItemContent={(arg) =>
                calendarEventContent(arg, configuration)
              }
              itemDidMount={(arg) => describeEvent(arg, configuration)}
              onItemClick={({ item }) => {
                const metadata = item.data?.metadata;
                if (metadata)
                  onOpen(metadata.entry.task, metadata.occurrence?.date);
              }}
              onItemContextMenu={(arg) => openContextActions(arg)}
              onItemDrop={(info) => void moveEvent(info)}
              onItemResize={(info) => void resizeEvent(info)}
              onSelect={createFromSelection}
              onDateClick={selectDate}
              onRangeChange={(view: ViewInfo) => {
                setTitle(view.title);
                setRange({
                  start: new Date(view.range.start.getTime()),
                  end: new Date(view.range.end.getTime()),
                });
              }}
            />
          </div>
          {legend.length && !listMode ? (
            <ul
              className="full-calendar-legend"
              aria-label={t`Calendar markers`}
            >
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
          <aside
            className="full-calendar-inspector"
            aria-label={t`Selected day`}
          >
            <header>
              <h2>{agendaLabel(selected)}</h2>
              <span>{countLabel(selectedEntries.length, "task")}</span>
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
              <p>
                <Trans>
                  No tasks on this day. Use Add task to schedule one.
                </Trans>
              </p>
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
  {
    value: "dayGridMonth",
    view: "month",
    get label() {
      return t`Month`;
    },
    compact: true,
  },
  {
    value: "timeGridWeek",
    view: "week",
    get label() {
      return t`Week`;
    },
    compact: false,
  },
  {
    value: "timeGridThreeDay",
    view: "days",
    get label() {
      return t`3 days`;
    },
    compact: true,
  },
  {
    value: "timeGridDay",
    view: "day",
    get label() {
      return t`Day`;
    },
    compact: false,
  },
  {
    value: "listWeek",
    view: "list",
    get label() {
      return t`Agenda`;
    },
    compact: true,
  },
];

function calendarView(mode: CalendarMode): ViewType {
  return calendarModes.find((option) => option.value === mode)?.view ?? "month";
}

/** Stamps what an item draws as its `rev`, leaving the task records out. */
function withRevision(item: TaskCalendarItem): TaskCalendarItem {
  const data = { ...item.data! } as Partial<CalendarEventData>;
  delete data.metadata;
  return { ...item, rev: JSON.stringify({ ...item, data }) };
}

function calendarEventContent(
  { item, el, variant, timeText }: ItemArg<CalendarEventData>,
  configuration: TaskCollectionConfiguration,
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
  const listView = variant === "list";
  const details = presentation?.details ?? [];
  const kind = localizedEntryKind(
    calendarEntryKind(presentation?.kind, details, listView, configuration),
  );
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

/** Names the entry for assistive technology; phone-month dots only take a priority colour. */
function describeEvent(
  { item, el, variant }: ItemArg<CalendarEventData>,
  configuration: TaskCollectionConfiguration,
) {
  el.dataset.date = calendarDay(item.start);
  const presentation = item.data;
  const marker = presentation?.marker;
  if (variant === "indicator") {
    // The day cell is the target and the day list holds the tasks; only an
    // elevated priority colours the dot.
    if (marker) el.style.setProperty("--event-tone", marker.color);
    return;
  }
  const kind = localizedEntryKind(
    calendarEntryKind(
      presentation?.kind,
      presentation?.details ?? [],
      variant === "list",
      configuration,
    ),
  );
  el.setAttribute(
    "aria-label",
    `${kind ? `${kind}: ` : ""}${calendarEventLabel(item)}${marker ? `, ${marker.label.toLowerCase()}` : ""}`,
  );
  if (marker) el.title = marker.label;
}

function localizedEntryKind(kind: string | undefined): string | undefined {
  return kind === "Due"
    ? t`Due`
    : kind === "Tracked time"
      ? t`Tracked time`
      : kind;
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
      ? t`Today`
      : new Intl.DateTimeFormat(appLocale(), {
          weekday: "long",
          month: "long",
          day: "numeric",
        }).format(start);
  const time = item.allDay
    ? ""
    : `, ${new Intl.DateTimeFormat(appLocale(), {
        hour: "numeric",
        minute: "2-digit",
      }).format(start)}`;
  return `${item.title} ${date}${time}`;
}

function listDayLabel(date: Date): string {
  return new Intl.DateTimeFormat(appLocale(), {
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

function agendaLabel(value: string): string {
  const date = dateFromStorage(value);
  return date
    ? new Intl.DateTimeFormat(appLocale(), {
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

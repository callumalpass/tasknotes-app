import "@tasknotes/calendar/calendar.css";
import { plural, t } from "@lingui/core/macro";
import { useLingui, Trans } from "@lingui/react/macro";
import { OverdueScheduleActions } from "../components/overdue-schedule-actions";
import { TaskListSection } from "../components/task-list-section";
import { missedDeadlineCount } from "../domain/task-list-sections";
import { appLocale } from "../i18n/app";
import { calendarText } from "../i18n/calendar-locale";
import { countLabel } from "../i18n/default-labels";

import { TaskCalendar } from "@tasknotes/calendar/react";
import { formatDay } from "@tasknotes/calendar";
import {
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  Plus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  calendarItems,
  calendarAgendaOrder,
  type CalendarEventData,
  type CalendarEventMetadata,
  type TaskCalendarItem,
} from "./calendar-items";
import { GoogleEventDialog } from "../calendar-service/event-dialog";
import { calendarServiceFailureMessage } from "../calendar-service/failure-message";
import { useGoogleCalendarOverlay } from "../calendar-service/use-google-calendar-overlay";
import { TaskActions } from "../components/task-actions";
import { useCalendarOverflow } from "./use-calendar-overflow";
import { useCalendarPosition } from "./use-calendar-position";
import { useCalendarPreviews } from "./use-calendar-previews";
import { useCalendarAgenda } from "./use-calendar-agenda";
import { useCalendarMonthLayout } from "./use-calendar-month-layout";
import { useCalendarTimedLayout } from "./use-calendar-timed-layout";
import {
  calendarEntryKind,
  calendarPriorityLegend,
  withPendingMoves,
  withoutSupersededMoves,
  type PendingCalendarMove,
} from "./calendar-event-presentation";
import { TaskRow } from "../components/task-row";
import { calendarRowDetails } from "./calendar-row-details";
import { ViewOptions } from "../components/view-options";
import {
  calendarEntryKey,
  type CalendarEntry,
} from "../domain/calendar-events";
import {
  calendarClearedInstances,
  calendarOccurrenceChoice,
  type CalendarTaskEdit,
} from "../domain/calendar-edit";
import type { CalendarOccurrenceChoice } from "@tasknotes/model/calendar";
import {
  ClearRecurringHistoryDialog,
  RecurringEditScopeDialog,
  type ClearRecurringHistoryRequest,
  type RecurringEditScope,
  type RecurringEditScopeRequest,
} from "../components/recurring-edit-scope-dialog";
import { formatOccurrenceDate } from "./task-editor-draft";
import { dateFromStorage, taskDatePart, todayString } from "../domain/task";
import { useRepository } from "./repository-context";
import {
  DEFAULT_CALENDAR_SLOT_HEIGHT,
  validSlotHeight,
  type CalendarHourFormat,
  type CalendarPreferences,
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
import type { TaskViewExecution, TaskViewRow } from "../domain/view";

/** View names as stored in `.base` files, shared with the TaskNotes plugin. */
type CalendarMode =
  | "dayGridMonth"
  | "timeGridWeek"
  | "timeGridThreeDay"
  | "timeGridDay"
  | "listWeek"
  | "multiMonthYear";

const PHONE_QUERY = "(max-width: 839px)";
/** From here the selected day's tasks sit beside the calendar, not below it. */
const DAY_LIST_BESIDE_QUERY = "(min-width: 1200px)";
/** How long a saved move outlasts view data that still shows the old place. */
const HELD_MOVE_LIMIT_MS = 5000;

export function TaskCalendarView({
  execution,
  preferences,
  onSlotHeightChange,
  identityTasks,
  selected,
  selectedCreateValue,
  titleProperty,
  onSelect,
  onCreate,
  onOpen: onOpenTask,
  onToggle,
  onEdit,
  onMoveOverdueToToday,
  movingOverdue,
}: {
  execution: TaskViewExecution;
  preferences: CalendarPreferences;
  onSlotHeightChange?(slotHeight: number): void;
  identityTasks: readonly TaskSummary[];
  selected: string;
  selectedCreateValue: string;
  titleProperty: string;
  onSelect(date: string, createValue?: string): void;
  onCreate(date: string, createValue?: string, timeEstimate?: number): void;
  onOpen(task: TaskSummary, occurrenceDate?: string): void;
  onToggle(task: TaskSummary, occurrenceDate?: string): void;
  onEdit(task: TaskSummary, edit: CalendarTaskEdit): Promise<void>;
  onMoveOverdueToToday?(
    rows: readonly TaskViewRow[],
    date: string,
    keepDeadlines: boolean,
  ): Promise<void>;
  movingOverdue?: boolean;
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
  const inspectorRef = useRef<HTMLElement>(null);
  const [initialDate] = useState(selected);
  const [mode, setMode] = useState<CalendarMode>(() =>
    calendarMode(execution.view.presentation?.options.calendarView),
  );
  const [inspectingDay, setInspectingDay] = useState(false);
  useEffect(() => {
    if (mode.startsWith("timeGrid"))
      calendarRef.current?.scrollToTime("08:00:00");
  }, [mode]);
  const phone = useMediaQuery(PHONE_QUERY);
  const phoneMonth = phone && mode === "dayGridMonth";
  const fineMonth =
    useMediaQuery("(min-width: 840px) and (pointer: fine)") &&
    mode === "dayGridMonth";
  // One agenda on every screen: keep the calendar's date navigation, lazy
  // day loading and drag semantics, with ordinary task rows inside it.
  const agenda = mode === "listWeek";
  const stripped =
    agenda ||
    (phone && (mode === "timeGridThreeDay" || mode === "timeGridDay"));
  const [leadSlot, setLeadSlot] = useState<HTMLElement | null>(null);
  const [inspection, setInspection] = useState<{
    label: string;
    left: number;
    top: number;
  } | null>(null);
  const inspectingDrag = useRef(false);
  const selectedTouchDay = useRef(false);
  const stripGestureStart = useRef<string | undefined>(undefined);
  function revealStripStart() {
    requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLButtonElement>(".tnc-strip-day")
        ?.click();
    });
  }
  useEffect(() => {
    const release = () => {
      inspectingDrag.current = false;
      setInspection(null);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);
  function inspectEvent(target: EventTarget | null) {
    const event = (target as Element | null)?.closest?.<HTMLElement>(
      '.tnc-item[role="button"]:not(.tnc-item--list)',
    );
    const label = event?.getAttribute("aria-label");
    if (!event || !label) return;
    const bounds = event.getBoundingClientRect();
    setInspection({
      label,
      left: Math.max(12, Math.min(bounds.left, window.innerWidth - 332)),
      top: Math.max(12, Math.min(bounds.bottom + 8, window.innerHeight - 104)),
    });
  }
  const [title, setTitle] = useState("");
  // The external calendar updates its title on a language change without
  // emitting onRangeChange when the visible dates stay the same.
  useEffect(() => {
    const view = calendarRef.current?.getView();
    if (view) setTitle(view.title);
  }, [locale]);
  const [range, setRange] = useState(() => initialRange(selected, mode));
  useCalendarPosition(rootRef, mode, phone, selected, range.start.getTime());
  useCalendarPreviews(rootRef, (day) => {
    inspectDate(day);
  });
  const [mutationError, setMutationError] = useState("");
  const [contextAction, setContextAction] = useState<{
    id: number;
    metadata: CalendarEventMetadata;
    x: number;
    y: number;
  } | null>(null);
  const { configuration, materializeOccurrence } = useRepository();
  const { timezone } = calendarContext();
  const [historyRequest, setHistoryRequest] = useState<
    (ClearRecurringHistoryRequest & { resolve(proceed: boolean): void }) | null
  >(null);
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
  // Forget moves once view data shows them, so a later Undo is drawn as is.
  const [prunedFor, setPrunedFor] = useState(built);
  if (prunedFor !== built) {
    setPrunedFor(built);
    const kept = withoutSupersededMoves(pendingMoves, built.items, execution);
    if (kept !== pendingMoves) setPendingMoves(kept);
  }
  const google = useGoogleCalendarOverlay(range);
  const items = useMemo(
    () =>
      [
        ...withPendingMoves(built.items, pendingMoves, execution).filter(
          (item) => !repeatsToday(item),
        ),
        ...google.items,
      ].map(withRevision),
    [built, execution, pendingMoves, google.items],
  );
  const agendaRows = useCalendarAgenda({
    root: rootRef,
    calendar: calendarRef,
    enabled: agenda,
    selected,
    items,
    locale,
    execution,
    identityTasks,
    configuration,
    display,
  });
  useCalendarTimedLayout(rootRef, mode.startsWith("timeGrid"));
  const monthLayout = useCalendarMonthLayout(
    rootRef,
    mode === "dayGridMonth",
    items.length,
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
    (entry) => !entry.timeEntry && !entry.modelEntry.isOverdueOnToday,
  );
  const selectedGoogleItems = google.items.filter((item) => {
    const dayStart = dateFromStorage(selected)!;
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const start = item.allDay
      ? dateFromStorage(calendarDay(item.start))!
      : new Date(item.start);
    const end = item.end
      ? item.allDay
        ? dateFromStorage(calendarDay(item.end))!
        : new Date(item.end)
      : start;
    return start < dayEnd && (end > dayStart || start >= dayStart);
  });
  const listMode = mode === "listWeek";
  const markers =
    legend.length && !listMode && mode !== "multiMonthYear" ? (
      <ul className="full-calendar-legend" aria-label={t`Calendar markers`}>
        {legend.map((marker) => (
          <li
            key={marker.value}
            style={{ "--event-tone": marker.color } as React.CSSProperties}
          >
            <i aria-hidden="true" />
            {marker.label}
          </li>
        ))}
      </ul>
    ) : null;

  // Rows name an elevated priority so the grid's coloured marks read the
  // same here; without view properties the row's defaults already do.
  function inspectorDetails(entry: CalendarEntry, day?: string) {
    return calendarRowDetails(
      entry,
      execution,
      titleProperty,
      configuration,
      day,
    );
  }

  function holdMove(id: string, move: PendingCalendarMove | undefined) {
    setPendingMoves((current) => {
      const next = new Map(current);
      if (move) next.set(id, move);
      else next.delete(id);
      return next;
    });
  }

  /** Holds the dropped place until view data shows the accepted write. */
  async function saveMove(
    id: string,
    placement: Omit<PendingCalendarMove, "from" | "settledWith">,
    save: () => Promise<void>,
    revert: () => void,
  ) {
    const drawn = built.items.find((item) => item.id === id);
    const move: PendingCalendarMove = {
      ...placement,
      from: { start: drawn?.start, end: drawn?.end, allDay: drawn?.allDay },
    };
    holdMove(id, move);
    try {
      await save();
    } catch (reason) {
      holdMove(id, undefined);
      revert();
      setMutationError(message(reason));
      return;
    }
    const settled = { ...move, settledWith: executionRef.current };
    holdMove(id, settled);
    // Should the data never show the move (another device moved it back),
    // the data wins after a while.
    window.setTimeout(
      () =>
        setPendingMoves((current) => {
          if (current.get(id) !== settled) return current;
          const next = new Map(current);
          next.delete(id);
          return next;
        }),
      HELD_MOVE_LIMIT_MS,
    );
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

  /** A series change that clears recorded occurrences goes ahead only once the user agrees. */
  function keepsHistoryOrAgreed(
    task: CalendarEventMetadata["entry"]["task"],
    edit: CalendarTaskEdit,
  ): true | Promise<boolean> {
    const cleared = calendarClearedInstances(task, edit, configuration);
    // Synchronous when nothing is cleared, so the moved item holds its place at once.
    if (!cleared.length) return true;
    return new Promise<boolean>((resolve) =>
      setHistoryRequest({
        title: task.title,
        dates: cleared.map(formatOccurrenceDate),
        resolve,
      }),
    );
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
    const agreed = keepsHistoryOrAgreed(metadata.entry.task, edit);
    if (agreed !== true && !(await agreed)) {
      info.revert();
      return;
    }
    await saveMove(
      id,
      {
        start: info.startStr,
        // Untimed tasks and open time entries keep their implicit length.
        ...(info.item.end ? { end: info.endStr } : {}),
        allDay: info.allDay,
      },
      () => onEdit(metadata.entry.task, edit),
      info.revert,
    );
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
    const agreed = keepsHistoryOrAgreed(metadata.entry.task, edit);
    if (agreed !== true && !(await agreed)) {
      info.revert();
      return;
    }
    await saveMove(
      id,
      { start: info.startStr, end: info.endStr, allDay: info.allDay },
      () => onEdit(metadata.entry.task, edit),
      info.revert,
    );
  }

  function inspectDate(dateStr: string, startStr?: string) {
    setInspectingDay(true);
    requestAnimationFrame(() => {
      inspectorRef.current?.focus({ preventScroll: true });
      // Below the side-by-side width the day's tasks open under the grid.
      if (!window.matchMedia?.(DAY_LIST_BESIDE_QUERY).matches)
        inspectorRef.current?.scrollIntoView?.({ block: "nearest" });
    });
    // A slot names its time, so the day's Add task starts there.
    onSelect(dateStr, startStr);
  }

  function selectDate({ dateStr, startStr, allDay, jsEvent }: DateClickArg) {
    if (allDay && "pointerType" in jsEvent && jsEvent.pointerType === "touch")
      selectedTouchDay.current = true;
    if (agenda) {
      onSelect(dateStr, startStr);
      if (
        jsEvent.target instanceof Element &&
        jsEvent.target.closest(".tnc-strip")
      )
        requestAnimationFrame(() => {
          rootRef.current
            ?.querySelector(`.tnc-list-day[data-date="${dateStr}"]`)
            ?.closest(".tnc-list-section")
            ?.scrollIntoView({ block: "start" });
        });
      return;
    }
    inspectDate(dateStr, startStr);
    // Below twelve months the day's tasks would be out of sight, so a year
    // day opens its month, as phone calendars do.
    if (
      mode === "multiMonthYear" &&
      !window.matchMedia?.(DAY_LIST_BESIDE_QUERY).matches
    ) {
      calendarRef.current?.gotoDate(dateStr);
      setMode("dayGridMonth");
    }
    // Mouse clicks on a slot also select it, which starts capture; a tap on a
    // phone only clicks, so a timed tap starts capture at that time itself.
    if (!allDay && "pointerType" in jsEvent && jsEvent.pointerType === "touch")
      onCreate(dateStr, startStr);
  }

  function createFromSelection(info: SelectArg) {
    // Agenda days have their own Add task; a click on a heading only reads it.
    if (
      agenda ||
      (info.jsEvent?.target instanceof Element &&
        info.jsEvent.target.closest(".tnc-dh"))
    ) {
      calendarRef.current?.unselect();
      return;
    }
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

  // The Overdue section moves to today as the Today view's Overdue lane
  // does: Scheduled becomes today and Due stays the deadline.
  const overdueRows = useMemo(() => {
    const rows = new Map<string, TaskViewRow>();
    for (const item of items) {
      const entry = item.data?.metadata?.entry;
      if (!entry?.modelEntry.isOverdueOnToday) continue;
      rows.set(entry.row.task.id, entry.row);
    }
    return [...rows.values()];
  }, [items]);

  const layoutSwitcher = (
    <ViewOptions
      label={t`Calendar layout`}
      icon={
        <>
          <LayoutGrid aria-hidden="true" size={16} />
          <span>
            {calendarModes.find(({ value }) => value === mode)?.label}
          </span>
        </>
      }
    >
      {calendarModes.map(({ value, label }) => (
        <button
          aria-pressed={mode === value}
          key={value}
          type="button"
          onClick={() => {
            setInspectingDay(false);
            setMode(value);
          }}
        >
          {mode === value ? (
            <Check aria-hidden="true" size={18} />
          ) : (
            <span aria-hidden="true" className="layout-option-space" />
          )}
          {label}
        </button>
      ))}
    </ViewOptions>
  );

  return (
    <div
      ref={rootRef}
      onPointerOver={(event) => inspectEvent(event.target)}
      onFocusCapture={(event) => inspectEvent(event.target)}
      onPointerDownCapture={(event) => {
        selectedTouchDay.current = false;
        stripGestureStart.current = (event.target as Element).closest(
          ".tnc-strip",
        )
          ? rootRef.current?.querySelector<HTMLElement>(".tnc-strip-day")
              ?.dataset.date
          : undefined;
        if ((event.target as Element).closest(".tnc-item--timed")) {
          inspectingDrag.current = true;
          inspectEvent(event.target);
        }
      }}
      onClickCapture={(event) => {
        if (!selectedTouchDay.current || event.detail === 0) return;
        selectedTouchDay.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        if (agenda && (event.target as Element).closest(".tnc-strip-nav"))
          revealStripStart();
      }}
      onPointerUp={() => {
        if (
          agenda &&
          stripGestureStart.current &&
          stripGestureStart.current !==
            rootRef.current?.querySelector<HTMLElement>(".tnc-strip-day")
              ?.dataset.date
        )
          revealStripStart();
      }}
      onPointerOut={(event) => {
        if (
          !inspectingDrag.current &&
          !(event.relatedTarget as Element | null)?.closest?.(
            '.tnc-item[role="button"]:not(.tnc-item--list)',
          )
        )
          setInspection(null);
      }}
      onBlurCapture={() => {
        if (!inspectingDrag.current) setInspection(null);
      }}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") setInspection(null);
      }}
      onKeyDown={(event) => {
        if (
          agenda &&
          event.key.startsWith("Arrow") &&
          (event.target as Element).closest(".tnc-strip-day")
        )
          requestAnimationFrame(() => {
            const focused = document.activeElement;
            if (
              focused instanceof HTMLButtonElement &&
              focused.matches(".tnc-strip-day")
            )
              focused.click();
          });
      }}
      data-calendar-mode={mode}
      className={`full-calendar-view${listMode ? " is-agenda" : ""}${mode === "timeGridDay" ? " is-day" : ""}${inspectingDay || phoneMonth ? " has-day-inspector" : ""}`}
    >
      <div className="full-calendar-workspace">
        {/* The layout switcher belongs to the calendar it changes, so it sits
            on the date row above the grid or agenda on every screen. */}
        <div className="full-calendar-main">
          {agenda && leadSlot && onMoveOverdueToToday && overdueRows.length
            ? createPortal(
                <TaskListSection
                  label={t`Overdue`}
                  count={overdueRows.length}
                  laneKey="section:overdue"
                  preferenceKey={`tasknotes:agenda-overdue:${execution.view.key}`}
                  headingOnly
                  action={
                    <OverdueScheduleActions
                      count={overdueRows.length}
                      deadlines={missedDeadlineCount(overdueRows)}
                      pending={Boolean(movingOverdue)}
                      onSchedule={(date, keepDeadlines) =>
                        onMoveOverdueToToday(overdueRows, date, keepDeadlines)
                      }
                    />
                  }
                >
                  {null}
                </TaskListSection>,
                leadSlot,
              )
            : null}
          <div className="full-calendar-commandbar">
            <div className="full-calendar-navigation">
              <button
                aria-label={agenda ? t`Previous week` : t`Previous period`}
                type="button"
                onClick={() =>
                  agenda
                    ? rootRef.current
                        ?.querySelector<HTMLButtonElement>(".tnc-strip-prev")
                        ?.click()
                    : calendarRef.current?.prev()
                }
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
              {google.writable.length ? (
                <button
                  type="button"
                  onClick={() => google.create(selected, selectedCreateValue)}
                >
                  <Trans>New event</Trans>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  agenda
                    ? rootRef.current
                        ?.querySelector<HTMLButtonElement>(".tnc-strip-today")
                        ?.click()
                    : calendarRef.current?.goToday()
                }
              >
                <Trans>Today</Trans>
              </button>
              <button
                aria-label={agenda ? t`Next week` : t`Next period`}
                type="button"
                onClick={() =>
                  agenda
                    ? rootRef.current
                        ?.querySelector<HTMLButtonElement>(".tnc-strip-next")
                        ?.click()
                    : calendarRef.current?.next()
                }
              >
                <ChevronRight aria-hidden="true" size={19} />
              </button>
            </div>
            <h2 aria-live="polite" hidden={stripped && !agenda}>
              {agenda ? (
                <button
                  className="agenda-range-toggle"
                  type="button"
                  aria-expanded={agendaRows.expanded}
                  onClick={() =>
                    rootRef.current
                      ?.querySelector<HTMLButtonElement>(".tnc-strip-title")
                      ?.click()
                  }
                >
                  {agendaRows.stripTitle}
                  <ChevronDown aria-hidden="true" size={14} />
                </button>
              ) : (
                title
              )}
            </h2>
            {layoutSwitcher}
          </div>
          {inspection
            ? createPortal(
                <div
                  className="calendar-event-inspection"
                  role="tooltip"
                  style={{ left: inspection.left, top: inspection.top }}
                >
                  {inspection.label}
                </div>,
                document.body,
              )
            : null}
          {historyRequest ? (
            <ClearRecurringHistoryDialog
              request={historyRequest}
              onChoose={(proceed) => {
                historyRequest.resolve(proceed);
                setHistoryRequest(null);
              }}
            />
          ) : null}
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
          {google.failure ? (
            <p className="inline-error" role="alert">
              {calendarServiceFailureMessage(google.failure)}
            </p>
          ) : null}
          {google.omitted ? (
            <p className="inline-error" role="status">
              {plural(google.omitted, {
                one: "# Google event couldn’t be shown.",
                other: "# Google events couldn’t be shown.",
              })}
            </p>
          ) : null}
          {google.enabled && !google.signedIn ? (
            <p className="section-copy" role="status">
              <Trans>
                Sign in to Google Calendar in Settings to see events.
              </Trans>
            </p>
          ) : null}
          {google.editor ? (
            <GoogleEventDialog
              request={google.editor}
              events={google.events}
              writable={google.writable}
              onSaved={google.replaceEvent}
              onChanged={google.reload}
              onClose={google.closeEditor}
            />
          ) : null}
          <div
            className={
              stripped
                ? "full-calendar-surface has-strip"
                : "full-calendar-surface"
            }
          >
            <TaskCalendar<CalendarEventData>
              calendarRef={(calendar) => {
                calendarRef.current = calendar;
              }}
              items={items}
              timeZone={timezone}
              locale={locale}
              // Selected day and imperative entry labels follow app language.
              // Agenda selection belongs to the date strip. Rebuilding its
              // whole list here would lose the position just scrolled to.
              renderKey={`${agenda ? "agenda" : selected}|${built.locale}`}
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
              listAgenda={agenda}
              eventOrder={calendarAgendaOrder(execution)}
              dateStrip={stripped}
              listLeadTitle={agenda ? t`Overdue` : null}
              listLeadIncludes={(item) =>
                !!item.data?.metadata?.entry.modelEntry.isOverdueOnToday
              }
              listLeadDidMount={({ el }) => setLeadSlot(el)}
              listLeadWillUnmount={({ el }) =>
                setLeadSlot((current) => (current === el ? null : current))
              }
              listAddText={agenda ? t`Add task` : null}
              onListAdd={({ dateStr }) => {
                onSelect(dateStr);
                onCreate(dateStr);
              }}
              toolbar={false}
              height={fineMonth ? "fill" : "auto"}
              style={fineMonth ? { height: monthLayout.height } : undefined}
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
              // A height chosen on this device, by pinching or in settings,
              // wins over the view's; the view can turn pinching off.
              slotHeight={
                preferences.slotHeight ??
                validSlotHeight(
                  execution.view.presentation?.options.slotHeight,
                ) ??
                DEFAULT_CALENDAR_SLOT_HEIGHT
              }
              pinchZoom={
                preferences.pinchZoom &&
                execution.view.presentation?.options.pinchZoom !== false
              }
              onSlotHeightChange={onSlotHeightChange}
              slotMinTime={preferences.slotMinTime}
              slotMaxTime={preferences.slotMaxTime}
              scrollTime="08:00:00"
              eventMinHeight={fineMonth ? 26 : 44}
              eventMaxStack={0}
              slotEventOverlap={false}
              // Phone months draw every task as a dot (the day cell is the
              // target) and list the selected day below.
              monthDisplay={phoneMonth ? "dots" : "full"}
              dayMaxEvents={
                phoneMonth ? monthLayout.dots : fineMonth ? true : 2
              }
              dayMaxEventRows={
                phoneMonth || fineMonth
                  ? 0
                  : mode === "timeGridDay"
                    ? 7
                    : mode.startsWith("timeGrid")
                      ? 2
                      : 3
              }
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
                agenda && !arg.isMirror && arg.item.data?.metadata
                  ? Object.assign(document.createElement("div"), {
                      className: "agenda-task-slot",
                    })
                  : calendarEventContent(arg, configuration)
              }
              itemDidMount={(arg) => {
                describeEvent(arg, configuration);
                if (agenda) agendaRows.mount(arg);
              }}
              itemWillUnmount={agendaRows.unmount}
              onItemClick={({ item }) => {
                if (item.data?.google) {
                  google.open(item.data.google);
                  return;
                }
                if (agenda) return;
                const metadata = item.data?.metadata;
                if (metadata)
                  onOpen(metadata.entry.task, metadata.occurrence?.date);
              }}
              onItemContextMenu={(arg) => {
                if (!agenda) openContextActions(arg);
              }}
              onItemDrop={(info) =>
                void (info.item.data?.google
                  ? google.move(info)
                  : moveEvent(info))
              }
              onItemResize={(info) =>
                void (info.item.data?.google
                  ? google.move(info)
                  : resizeEvent(info))
              }
              onSelect={createFromSelection}
              onDateClick={selectDate}
              onRangeChange={(view: ViewInfo) => {
                setTitle(view.title);
                // The data range also covers the date strip's later days. Its
                // earlier days stay out: a task dated inside the range is drawn
                // on that past day, not carried to today as overdue.
                setRange({
                  start: new Date(view.range.start.getTime()),
                  end: new Date(view.dataRange.end.getTime()),
                });
              }}
            />
            {[...agendaRows.slots].map(([slot, arg]) => {
              const item = items.find(({ id }) => id === arg.item.id);
              const entry = item?.data?.metadata?.entry;
              if (!item || !entry || !agenda) return null;
              const kind = localizedEntryKind(
                calendarEntryKind(
                  item.data?.kind,
                  item.data?.details ?? [],
                  true,
                  configuration,
                ),
              );
              return createPortal(
                <div
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => {
                    // Row buttons act normally; dragging the title or row space
                    // still reaches the calendar's existing move gesture.
                    if (
                      (event.target as HTMLElement).closest(
                        "button:not(.task-row-title), input, select, textarea",
                      )
                    )
                      event.stopPropagation();
                  }}
                >
                  <TaskRow
                    details={inspectorDetails(
                      entry,
                      entry.modelEntry.isOverdueOnToday
                        ? undefined
                        : formatDay(arg.day),
                    )}
                    occurrence={entry.occurrence}
                    supportingInline
                    supportingText={
                      [kind, agendaTime(arg.timeText, entry.task)]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                    task={entry.task}
                    onOpen={onOpen}
                    onToggle={onToggle}
                  />
                </div>,
                slot,
                `${arg.item.id}:${arg.day}`,
              );
            })}
          </div>
          {!phoneMonth ? markers : null}
        </div>
        {!listMode && (inspectingDay || phoneMonth) ? (
          <aside
            ref={inspectorRef}
            tabIndex={-1}
            className="full-calendar-inspector"
            aria-label={t`Selected day`}
          >
            <header>
              <h2>{agendaLabel(selected)}</h2>
              <span>{countLabel(selectedEntries.length, "task")}</span>
              {!phoneMonth ? (
                <button
                  aria-label={t`Close day details`}
                  className="icon-action"
                  type="button"
                  onClick={() => setInspectingDay(false)}
                >
                  <X aria-hidden="true" size={18} />
                </button>
              ) : null}
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
            {selectedGoogleItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="full-calendar-google-event"
                aria-label={calendarEventLabel(item)}
                style={{ "--c": item.color } as React.CSSProperties}
                onClick={() => google.open(item.data!.google!)}
              >
                <span>{item.title || t`(No title)`}</span>
                <small>
                  {[
                    !item.allDay
                      ? new Intl.DateTimeFormat(locale, {
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(new Date(item.start))
                      : null,
                    item.data!.google!.calendar.name,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </button>
            ))}
          </aside>
        ) : null}
        {phoneMonth ? markers : null}
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
}> = [
  {
    value: "dayGridMonth",
    view: "month",
    get label() {
      return t`Month`;
    },
  },
  {
    value: "timeGridWeek",
    view: "week",
    get label() {
      return t`Week`;
    },
  },
  {
    value: "timeGridThreeDay",
    view: "days",
    get label() {
      return t`3 days`;
    },
  },
  {
    value: "timeGridDay",
    view: "day",
    get label() {
      return t`Day`;
    },
  },
  {
    value: "listWeek",
    view: "list",
    get label() {
      return t`Agenda`;
    },
  },
  {
    value: "multiMonthYear",
    view: "year",
    get label() {
      return t`Year`;
    },
  },
];

function calendarView(mode: CalendarMode): ViewType {
  return calendarModes.find((option) => option.value === mode)?.view ?? "month";
}

/** Stamps what an item draws as its `rev`, leaving the task records out. */
/** A task scheduled today already has its row; a missed Due date adds no other. */
function repeatsToday(item: TaskCalendarItem): boolean {
  const entry = item.data?.metadata?.entry;
  return (
    !!entry?.modelEntry.isOverdueOnToday &&
    taskDatePart(entry.row.task.scheduled) === todayString()
  );
}

function withRevision(item: TaskCalendarItem): TaskCalendarItem {
  const data = { ...item.data! } as Partial<CalendarEventData>;
  delete data.metadata;
  delete data.google;
  return { ...item, rev: JSON.stringify({ ...item, data }) };
}

/** A task with no estimate has a start, not an end this list should invent. */
function agendaTime(timeText: string, task: TaskSummary) {
  return task.timeEstimate ? timeText : timeText.split(" – ")[0];
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
      presentation?.kind === "Due" ? "is-due" : "",
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
  const monthEntry = variant === "bar";
  const title = item.title || t`(No title)`;
  primary.append(
    node(
      "span",
      undefined,
      monthEntry ? [timeText, kind, title].filter(Boolean).join(" · ") : title,
    ),
  );
  if (!listView && !monthEntry && (timeText || kind)) {
    const secondary = node("span", "full-calendar-event-secondary");
    if (timeText) secondary.append(node("time", undefined, timeText));
    if (kind) secondary.append(node("em", "full-calendar-event-kind", kind));
    content.append(secondary);
  } else if (kind && listView)
    primary.append(node("em", "full-calendar-event-kind", kind));
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
  el.removeAttribute("title");
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
  if (typeof value === "string") return taskDatePart(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : todayString(date);
}

function calendarEventLabel(item: TaskCalendarItem): string {
  const start = new Date(item.start);
  const title = item.title || t`(No title)`;
  if (Number.isNaN(start.getTime())) return title;
  // An all-day date is a calendar day, not an instant: name that day everywhere.
  const day = item.allDay ? calendarDay(item.start) : todayString(start);
  const date =
    day === todayString()
      ? t`Today`
      : new Intl.DateTimeFormat(appLocale(), {
          weekday: "long",
          month: "long",
          day: "numeric",
          ...(item.allDay ? { timeZone: "UTC" } : {}),
        }).format(item.allDay ? new Date(`${day}T00:00:00Z`) : start);
  const time = item.allDay
    ? ""
    : `, ${new Intl.DateTimeFormat(appLocale(), {
        hour: "numeric",
        minute: "2-digit",
      }).format(start)}`;
  return `${title} ${date}${time}`;
}

function listDayLabel(date: Date): string {
  const label = new Intl.DateTimeFormat(appLocale(), {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
  const day = todayString(date);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return day === todayString()
    ? t`Today · ${label}`
    : day === todayString(tomorrow)
      ? t`Tomorrow · ${label}`
      : label;
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
  if (mode === "multiMonthYear")
    return {
      start: new Date(date.getFullYear(), 0, 1),
      end: new Date(date.getFullYear() + 1, 0, 1),
    };
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

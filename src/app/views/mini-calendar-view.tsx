import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { calendarEntryKey, calendarEvents } from "../../domain/calendar-events";
import { dateFromStorage, todayString } from "../../domain/task";
import { ViewTaskRow } from "./view-task-row";
import {
  calendarMonthGrid,
  orderedWeekdays,
  startOfCalendarWeek,
} from "../calendar-preferences";

import type { Task } from "../../domain/task";
import type { TaskViewExecution } from "../../domain/view";

export function MiniCalendarView({
  execution,
  firstDay,
  identityTasks,
  selected,
  titleProperty,
  onSelect,
  onCreate,
  onOpen,
  onToggle,
}: {
  execution: TaskViewExecution;
  firstDay: number;
  identityTasks: readonly Task[];
  selected: string;
  titleProperty: string;
  onSelect(date: string): void;
  onCreate(date: string): void;
  onOpen(task: Task, occurrenceDate?: string): void;
  onToggle(task: Task, occurrenceDate?: string): void;
}) {
  const initial = dateFromStorage(todayString()) ?? new Date();
  const [month, setMonth] = useState(
    () => new Date(initial.getFullYear(), initial.getMonth(), 1),
  );
  const [focusedDate, setFocusedDate] = useState(
    selected || storageDate(initial),
  );
  const dateRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusRequested = useRef(false);
  const days = useMemo(
    () => calendarMonthGrid(month, firstDay),
    [firstDay, month],
  );
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
  useEffect(() => {
    if (!focusRequested.current) return;
    dateRefs.current.get(focusedDate)?.focus();
    focusRequested.current = false;
  }, [focusedDate, month]);

  function moveFocus(day: Date) {
    focusRequested.current = true;
    if (
      day.getMonth() !== month.getMonth() ||
      day.getFullYear() !== month.getFullYear()
    )
      setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
    setFocusedDate(storageDate(day));
  }

  function chooseDate(day: Date) {
    const date = storageDate(day);
    setFocusedDate(date);
    onSelect(date);
  }

  function changeMonth(amount: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + amount, 1);
    setMonth(next);
    setFocusedDate(storageDate(next));
  }

  return (
    <div className="mini-calendar-view">
      <div className="mini-calendar-toolbar">
        <button
          aria-label="Previous month"
          type="button"
          onClick={() => changeMonth(-1)}
        >
          <ChevronLeft aria-hidden="true" size={20} />
        </button>
        <h2>{monthLabel}</h2>
        <button
          aria-label="Next month"
          type="button"
          onClick={() => changeMonth(1)}
        >
          <ChevronRight aria-hidden="true" size={20} />
        </button>
        <button
          aria-label={`Add task on ${agendaLabel(selected)}`}
          className="mini-calendar-create"
          type="button"
          onClick={() => onCreate(selected)}
        >
          <Plus aria-hidden="true" size={18} />
        </button>
      </div>
      <div className="mini-calendar-weekdays" aria-hidden="true">
        {orderedWeekdays(firstDay).map((day, index) => (
          <span key={`${day}:${index}`}>{day}</span>
        ))}
      </div>
      <div className="mini-calendar-grid" role="grid" aria-label={monthLabel}>
        {Array.from({ length: 6 }, (_, week) => (
          <div key={week} role="row">
            {days.slice(week * 7, week * 7 + 7).map((day) => {
              const date = storageDate(day);
              const entries = events.get(date) ?? [];
              const count = entries.length;
              return (
                <button
                  aria-label={`${day.toLocaleDateString()}, ${count} ${count === 1 ? "task" : "tasks"}`}
                  aria-selected={selected === date}
                  className={
                    day.getMonth() === month.getMonth() ? "" : "outside"
                  }
                  key={date}
                  ref={(element) => {
                    if (element) dateRefs.current.set(date, element);
                    else dateRefs.current.delete(date);
                  }}
                  role="gridcell"
                  tabIndex={focusedDate === date ? 0 : -1}
                  type="button"
                  onClick={() => chooseDate(day)}
                  onKeyDown={(event) => {
                    const movement = {
                      ArrowLeft: -1,
                      ArrowRight: 1,
                      ArrowUp: -7,
                      ArrowDown: 7,
                    }[event.key];
                    if (movement !== undefined) {
                      event.preventDefault();
                      moveFocus(addCalendarDays(day, movement));
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      moveFocus(startOfCalendarWeek(day, firstDay));
                    } else if (event.key === "End") {
                      event.preventDefault();
                      moveFocus(
                        addCalendarDays(startOfCalendarWeek(day, firstDay), 6),
                      );
                    } else if (event.key === "PageUp") {
                      event.preventDefault();
                      moveFocus(addCalendarMonths(day, -1));
                    } else if (event.key === "PageDown") {
                      event.preventDefault();
                      moveFocus(addCalendarMonths(day, 1));
                    }
                  }}
                >
                  <span className="mini-calendar-date-number">
                    {day.getDate()}
                  </span>
                  {count ? (
                    <span
                      className="mini-calendar-cell-tasks"
                      aria-hidden="true"
                    >
                      {entries.slice(0, 3).map((entry) => (
                        <span
                          key={calendarEntryKey(entry)}
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
        ))}
      </div>
      <section className="mini-calendar-agenda">
        <h2>{agendaLabel(selected)}</h2>
        {selectedTasks.length ? (
          selectedTasks.map((entry) => (
            <ViewTaskRow
              key={calendarEntryKey(entry)}
              row={entry.row}
              properties={execution.view.properties}
              titleProperty={titleProperty}
              occurrence={entry.occurrence}
              onOpen={onOpen}
              onToggle={onToggle}
            />
          ))
        ) : (
          <p>No tasks on this day. Use Add task to schedule one.</p>
        )}
      </section>
    </div>
  );
}

function addCalendarDays(date: Date, amount: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + amount,
    12,
  );
}

function addCalendarMonths(date: Date, amount: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
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

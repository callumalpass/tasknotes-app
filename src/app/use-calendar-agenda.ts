import { t } from "@lingui/core/macro";
import { parseDay, type Calendar, type ItemArg } from "@tasknotes/calendar";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { appLocale } from "../i18n/app";
import { countLabel } from "../i18n/default-labels";
import {
  dateFromStorage,
  taskDatePart,
  todayString,
  type TaskSummary,
} from "../domain/task";
import type { CalendarSettings } from "@tasknotes/model/calendar";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskViewExecution } from "../domain/view";
import { useCalendarEntries } from "./use-calendar-entries";
import type { CalendarEventData, TaskCalendarItem } from "./calendar-items";

/** React owns row contents; the calendar retains its scrolling and drag layer. */
export function useCalendarAgenda({
  root,
  calendar,
  enabled,
  items,
  locale,
  execution,
  identityTasks,
  configuration,
  display,
}: {
  root: RefObject<HTMLDivElement | null>;
  calendar: RefObject<Calendar<CalendarEventData> | null>;
  enabled: boolean;
  items: readonly TaskCalendarItem[];
  locale: string;
  execution: TaskViewExecution;
  identityTasks: readonly TaskSummary[];
  configuration: TaskCollectionConfiguration;
  display: CalendarSettings;
}) {
  const [slots, setSlots] = useState<
    ReadonlyMap<HTMLElement, ItemArg<CalendarEventData>>
  >(new Map());
  const [stripRange, setStripRange] = useState(() => {
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  });
  // Count the actual days shown in the strip, including past weeks. Widening
  // the main agenda projection instead would suppress its overdue-on-today
  // entries. No second expansion is needed while using a grid layout.
  const stripExecution = useMemo(
    () => (enabled ? execution : { ...execution, rows: [] }),
    [enabled, execution],
  );
  const entries = useCalendarEntries(
    stripExecution,
    stripRange,
    identityTasks,
    configuration,
    display,
  );

  function mount(arg: ItemArg<CalendarEventData>) {
    if (arg.variant !== "list" || arg.isMirror) return;
    const slot = arg.el.querySelector<HTMLElement>(".agenda-task-slot");
    if (!slot) return;
    // TaskRow supplies independent, named controls. The calendar wrapper must
    // not become a second button surrounding them.
    arg.el.removeAttribute("role");
    arg.el.removeAttribute("tabindex");
    arg.el.removeAttribute("aria-label");
    setSlots((current) => new Map(current).set(slot, arg));
  }

  function unmount({ el }: ItemArg<CalendarEventData>) {
    const slot = el.querySelector<HTMLElement>(".agenda-task-slot");
    if (!slot) return;
    setSlots((current) => {
      if (!current.has(slot)) return current;
      const next = new Map(current);
      next.delete(slot);
      return next;
    });
  }

  useEffect(() => {
    const host = root.current;
    if (!enabled || !host) return;
    // The calendar is an imperative renderer. Its strip is redrawn when the
    // list scrolls or another week is shown, independently of React. Decorate
    // those public DOM surfaces without taking ownership of their controls.
    function decorate() {
      const api = calendar.current;
      if (!api) return;
      const cells = host!.querySelectorAll<HTMLElement>(".tnc-strip-day");
      const start = dateFromStorage(cells[0]?.dataset.date ?? "");
      const end = dateFromStorage(cells[cells.length - 1]?.dataset.date ?? "");
      if (start && end) {
        end.setDate(end.getDate() + 1);
        setStripRange((current) =>
          current.start.getTime() === start.getTime() &&
          current.end.getTime() === end.getTime()
            ? current
            : { start, end },
        );
      }
      for (const cell of cells) {
        const value = cell.dataset.date ?? "";
        const day = parseDay(value);
        if (day === null) continue;
        const count = (entries.get(value) ?? []).filter(
          ({ modelEntry, row, timeEntry }) =>
            !timeEntry &&
            !modelEntry.isOverdueOnToday &&
            (api.opts.allDaySlot || !modelEntry.allDay) &&
            !plannedElsewhere(row.task, value),
        ).length;
        const date = new Date(`${value}T12:00:00`);
        const label = new Intl.DateTimeFormat(appLocale(), {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        }).format(date);
        cell.setAttribute(
          "aria-label",
          t`${label}, ${countLabel(count, "task")}`,
        );
        if (value === todayString()) cell.setAttribute("aria-current", "date");
        else cell.removeAttribute("aria-current");
        let weekday = cell.querySelector<HTMLElement>(".agenda-strip-weekday");
        if (!weekday) {
          weekday = document.createElement("span");
          weekday.className = "agenda-strip-weekday";
          weekday.setAttribute("aria-hidden", "true");
          cell.prepend(weekday);
        }
        weekday.textContent = new Intl.DateTimeFormat(appLocale(), {
          weekday: "short",
        }).format(date);
        let badge = cell.querySelector<HTMLElement>(".agenda-strip-count");
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "agenda-strip-count";
          badge.setAttribute("aria-hidden", "true");
          cell.append(badge);
        }
        badge.textContent = String(count);
      }
      const prev = host!.querySelector(".tnc-strip-prev");
      const next = host!.querySelector(".tnc-strip-next");
      prev?.setAttribute("aria-label", t`Previous week`);
      prev?.setAttribute("title", t`Previous week`);
      next?.setAttribute("aria-label", t`Next week`);
      next?.setAttribute("title", t`Next week`);
      host!.querySelector(".tnc-strip-today")?.removeAttribute("hidden");
      // The same controls expand to a month on phones; name that operation
      // accurately while retaining the familiar disclosure.
      if (host!.querySelector(".tnc-strip.is-expanded")) {
        prev?.setAttribute("aria-label", t`Previous month`);
        next?.setAttribute("aria-label", t`Next month`);
      }
      for (const section of host!.querySelectorAll<HTMLElement>(
        ".tnc-list-section",
      )) {
        const heading = section.querySelector<HTMLElement>(".tnc-list-day");
        if (!heading) continue;
        heading.setAttribute("role", "heading");
        heading.setAttribute("aria-level", "2");
        let badge = heading.querySelector<HTMLElement>(".agenda-day-count");
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "agenda-day-count";
          const title = heading.querySelector(".tnc-list-lead-title");
          if (title) title.after(badge);
          else heading.append(badge);
        }
        const count = section.querySelectorAll(
          ".tnc-item--list:not(.is-time-entry)",
        ).length;
        badge.textContent = String(count);
        badge.setAttribute("aria-label", countLabel(count, "task"));
      }
      api.strip?.measure();
    }
    const observe = () =>
      observer.observe(host, { childList: true, subtree: true });
    const observer = new MutationObserver(() => {
      // Do not observe our own labels (or recursively redraw them).
      observer.disconnect();
      decorate();
      observe();
    });
    decorate();
    observe();
    return () => observer.disconnect();
  }, [root, calendar, enabled, items, locale, entries]);

  return { slots, mount, unmount };
}

/** The agenda lists a task on its planned day, so only that day counts it. */
export function plannedElsewhere(task: TaskSummary, day: string): boolean {
  const planned = taskDatePart(task.scheduled);
  return !!planned && !task.recurrence && planned !== day;
}

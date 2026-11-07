import { t } from "@lingui/core/macro";
import { parseDay, type Calendar, type ItemArg } from "@tasknotes/calendar";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { appLocale } from "../i18n/app";
import { countLabel } from "../i18n/default-labels";
import { dateFromStorage, todayString, type TaskSummary } from "../domain/task";
import type { CalendarSettings } from "@tasknotes/model/calendar";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskViewExecution } from "../domain/view";
import { useCalendarEntries } from "./use-calendar-entries";
import type { CalendarEventData, TaskCalendarItem } from "./calendar-items";
import { compactAgendaDays } from "./calendar-agenda-days";

/** React owns row contents; the calendar retains its scrolling and drag layer. */
export function useCalendarAgenda({
  root,
  calendar,
  enabled,
  selected,
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
  selected: string;
  items: readonly TaskCalendarItem[];
  locale: string;
  execution: TaskViewExecution;
  identityTasks: readonly TaskSummary[];
  configuration: TaskCollectionConfiguration;
  display: CalendarSettings;
}) {
  const previousSelection = useRef(selected);
  useEffect(() => {
    const changed = previousSelection.current !== selected;
    previousSelection.current = selected;
    if (!enabled || !changed) return;
    const frame = requestAnimationFrame(() => {
      root.current
        ?.querySelector<HTMLElement>(
          `.tnc-list-section[data-date="${selected}"]`,
        )
        ?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, root, selected]);
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
          ({ modelEntry, timeEntry }) =>
            !timeEntry &&
            !modelEntry.isOverdueOnToday &&
            (api.opts.allDaySlot || !modelEntry.allDay),
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
        badge.textContent = count ? String(count) : "";
        badge.hidden = count === 0;
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
        if (heading.querySelector(".task-section")) {
          heading.removeAttribute("role");
          heading.removeAttribute("aria-level");
          continue;
        }
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
          ".tnc-item--list:not(.is-time-entry):not(.google-calendar-event)",
        ).length;
        badge.textContent = count ? String(count) : "";
        badge.hidden = count === 0;
        badge.setAttribute("aria-label", countLabel(count, "task"));
      }
      compactAgendaDays(host!, selected, locale);
      const sentinel = host!.querySelector<HTMLElement>(".tnc-list-more");
      if (sentinel) {
        let more = host!.querySelector<HTMLButtonElement>(".agenda-load-more");
        if (!more) {
          more = document.createElement("button");
          more.type = "button";
          more.className = "agenda-load-more";
          more.addEventListener("click", () => {
            const sections = host!.querySelectorAll<HTMLElement>(
              ".tnc-list-section[data-date]",
            );
            const last = parseDay(
              sections[sections.length - 1]?.dataset.date ?? "",
            );
            if (last !== null) api!.extendList(last + 8);
          });
          sentinel.after(more);
        }
        more.textContent = t`Show more days`;
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
    const reveal = (event: MouseEvent) => {
      const day = (event.target as Element | null)?.closest<HTMLElement>(
        ".tnc-strip-day",
      )?.dataset.date;
      if (day) {
        observer.disconnect();
        compactAgendaDays(host, day, locale);
        observe();
      }
    };
    host.addEventListener("click", reveal, true);
    return () => {
      observer.disconnect();
      host.removeEventListener("click", reveal, true);
    };
  }, [root, calendar, enabled, items, locale, entries, selected]);

  const lastShown = new Date(stripRange.end);
  lastShown.setDate(lastShown.getDate() - 1);
  const stripTitle = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).formatRange(stripRange.start, lastShown);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const host = root.current;
    if (!enabled || !host) return;
    const update = () =>
      setExpanded(Boolean(host.querySelector(".tnc-strip.is-expanded")));
    const observer = new MutationObserver(update);
    observer.observe(host, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
    });
    update();
    return () => observer.disconnect();
  }, [enabled, root]);
  return { slots, mount, unmount, stripTitle, expanded };
}

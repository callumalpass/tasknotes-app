import { useEffect, useRef, useState, type RefObject } from "react";
import { appLocale } from "../i18n/app";

export function useCalendarPosition(
  rootRef: RefObject<HTMLElement | null>,
  mode: string,
  phone: boolean,
  selected: string,
  rangeStart: number,
) {
  const [visibleDays, setVisibleDays] = useState("");
  const positions = useRef(new Map<string, { top: number; left: number }>());
  const previousLayout = useRef("");

  useEffect(() => {
    const root = rootRef.current;
    if (mode !== "listWeek" || !root || typeof ResizeObserver === "undefined")
      return;
    let width = root.getBoundingClientRect().width;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      const nextWidth = root.getBoundingClientRect().width;
      if (nextWidth === width) return;
      width = nextWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root
          .querySelector(`.tnc-list-day[data-date="${selected}"]`)
          ?.closest(".tnc-list-section")
          ?.scrollIntoView({ block: "start" });
      });
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [mode, rootRef, selected]);

  useEffect(() => {
    const root = rootRef.current;
    const layout = `${mode}|${phone}`;
    const changedLayout = previousLayout.current !== layout;
    const resetOuter = changedLayout && previousLayout.current !== "";
    previousLayout.current = layout;
    if (root && resetOuter) resetOuterScroll(root);
    if (root) delete root.dataset.moreDays;
    if (!root || (mode !== "multiMonthYear" && !mode.startsWith("timeGrid")))
      return;
    const key = `${mode}|${phone}|${rangeStart}`;
    let scroller: HTMLElement | null = null;
    let extentObserver: ResizeObserver | undefined;
    const revealExtent = () => {
      if (scroller) {
        root.dataset.moreDays = String(
          mode.startsWith("timeGrid") &&
            scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft >
              2,
        );
        if (phone && mode === "timeGridWeek") {
          const bounds = scroller.getBoundingClientRect();
          const inset =
            root.querySelector(".tnc-gutter-head")?.getBoundingClientRect()
              .width ?? 0;
          const days = [
            ...root.querySelectorAll<HTMLElement>(".tnc-dh[data-date]"),
          ].filter((day) => {
            const column = day.getBoundingClientRect();
            return (
              column.right > bounds.left + inset + 1 &&
              column.left < bounds.right - 1
            );
          });
          const first = days[0]?.dataset.date;
          const last = days.at(-1)?.dataset.date;
          if (first && last) {
            const format = new Intl.DateTimeFormat(appLocale(), {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            setVisibleDays(
              format.formatRange(
                new Date(`${first}T12:00:00`),
                new Date(`${last}T12:00:00`),
              ),
            );
          }
        }
      }
    };
    const remember = () => {
      revealExtent();
      if (scroller && root.contains(scroller))
        positions.current.set(key, {
          top: scroller.scrollTop,
          left: scroller.scrollLeft,
        });
    };
    const frame = requestAnimationFrame(() => {
      scroller = root.querySelector<HTMLElement>(
        mode === "multiMonthYear" ? ".tnc-year-scroll" : ".tnc-tg-scroll",
      );
      if (!scroller) return;
      const restored = positions.current.get(key);
      if (restored) {
        scroller.scrollTop = restored.top;
        scroller.scrollLeft = restored.left;
      }
      if (!restored || changedLayout) {
        const target = root.querySelector<HTMLElement>(
          mode === "multiMonthYear"
            ? `.tnc-ym-day[data-date="${selected}"]`
            : `.tnc-dh[data-date="${selected}"]`,
        );
        const bounds = scroller.getBoundingClientRect();
        if (mode === "multiMonthYear") {
          const month = target?.closest(".tnc-ym");
          if (month) {
            const monthBounds = month.getBoundingClientRect();
            scroller.style.paddingBottom = phone
              ? `${Math.max(12, scroller.clientHeight - monthBounds.height)}px`
              : "";
            const toolbar = root.querySelector(".full-calendar-commandbar");
            const top = Math.max(
              bounds.top,
              toolbar?.getBoundingClientRect().bottom ?? bounds.top,
            );
            const desired =
              scroller.scrollTop +
              monthBounds.top -
              top -
              (parseFloat(getComputedStyle(scroller).paddingTop) || 0);
            scroller.scrollTop = phone
              ? desired
              : Math.max(
                  0,
                  Math.min(
                    desired,
                    scroller.scrollHeight - scroller.clientHeight,
                  ),
                );
          }
        } else if (target) {
          const gutter = root.querySelector(".tnc-gutter-head");
          const inset = gutter?.getBoundingClientRect().width ?? 0;
          const column = target.getBoundingClientRect();
          const left = bounds.left + inset;
          if (column.left < left || column.right > bounds.right)
            scroller.scrollLeft += column.left - left;
        }
        remember();
      }
      scroller.addEventListener("scroll", remember, { passive: true });
      revealExtent();
      if (typeof ResizeObserver !== "undefined") {
        extentObserver = new ResizeObserver(revealExtent);
        extentObserver.observe(scroller);
      }
      window.addEventListener("resize", revealExtent);
    });
    return () => {
      cancelAnimationFrame(frame);
      remember();
      scroller?.removeEventListener("scroll", remember);
      extentObserver?.disconnect();
      window.removeEventListener("resize", revealExtent);
    };
  }, [mode, phone, rangeStart, rootRef, selected]);
  return visibleDays;
}

function resetOuterScroll(root: HTMLElement) {
  for (let parent = root.parentElement; parent; parent = parent.parentElement)
    parent.scrollTop = 0;
  const page = root.ownerDocument.scrollingElement;
  if (page) page.scrollTop = 0;
}

import { useEffect, useRef, type RefObject } from "react";

export function useCalendarPosition(
  rootRef: RefObject<HTMLElement | null>,
  mode: string,
  phone: boolean,
  selected: string,
  rangeStart: number,
) {
  const positions = useRef(new Map<string, { top: number; left: number }>());

  useEffect(() => {
    const root = rootRef.current;
    if (!root || (mode !== "multiMonthYear" && !mode.startsWith("timeGrid")))
      return;
    const key = `${mode}|${phone}|${rangeStart}`;
    let scroller: HTMLElement | null = null;
    const remember = () => {
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
      } else {
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
            if (monthBounds.top < bounds.top)
              scroller.scrollTop += monthBounds.top - bounds.top;
            else if (monthBounds.bottom > bounds.bottom)
              scroller.scrollTop += Math.min(
                monthBounds.top - bounds.top,
                monthBounds.bottom - bounds.bottom,
              );
          }
        } else if (phone && mode !== "timeGridDay" && target) {
          const gutter = root.querySelector(".tnc-gutter-head");
          const inset = (gutter?.getBoundingClientRect().width ?? 0) + 24;
          scroller.scrollLeft +=
            target.getBoundingClientRect().left - bounds.left - inset;
        }
        remember();
      }
      scroller.addEventListener("scroll", remember, { passive: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      remember();
      scroller?.removeEventListener("scroll", remember);
    };
  }, [mode, phone, rangeStart, rootRef, selected]);
}

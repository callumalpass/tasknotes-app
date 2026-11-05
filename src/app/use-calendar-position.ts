import { useEffect, useRef, type RefObject } from "react";

export function useCalendarPosition(
  rootRef: RefObject<HTMLElement | null>,
  mode: string,
  phone: boolean,
  selected: string,
  rangeStart: number,
) {
  const positions = useRef(new Map<string, { top: number; left: number }>());
  const previousLayout = useRef("");

  useEffect(() => {
    const root = rootRef.current;
    const layout = `${mode}|${phone}`;
    const changedLayout = previousLayout.current !== layout;
    previousLayout.current = layout;
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
            scroller.scrollTop +=
              monthBounds.top -
              bounds.top -
              (parseFloat(getComputedStyle(scroller).paddingTop) || 0);
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
    });
    return () => {
      cancelAnimationFrame(frame);
      remember();
      scroller?.removeEventListener("scroll", remember);
    };
  }, [mode, phone, rangeStart, rootRef, selected]);
}

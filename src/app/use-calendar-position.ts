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
      if (scroller)
        root.dataset.moreDays = String(
          mode.startsWith("timeGrid") &&
            scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft >
              2,
        );
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
}

function resetOuterScroll(root: HTMLElement) {
  for (let parent = root.parentElement; parent; parent = parent.parentElement)
    parent.scrollTop = 0;
  const page = root.ownerDocument.scrollingElement;
  if (page) page.scrollTop = 0;
}

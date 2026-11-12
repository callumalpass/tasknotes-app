import { useEffect, useEffectEvent, type RefObject } from "react";
import { calendarText } from "../i18n/calendar-locale";
import {
  MONTH_MEASURE_CLASS,
  PREVIEW_MORE_CLASS,
  onlyTouched,
} from "./calendar-decorations";

export function useCalendarPreviews(
  rootRef: RefObject<HTMLElement | null>,
  onInspect: (day: string) => void,
) {
  const inspect = useEffectEvent(onInspect);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const synchronize = () => {
      observer.disconnect();
      resetPreviews(root);
      boundCalendarPreviews(root, inspect, calendarText().more!);
      observer.observe(root, { childList: true, subtree: true });
    };
    const observer = new MutationObserver((records) => {
      // The month's measuring node comes and goes without moving an entry.
      if (!onlyTouched(records, MONTH_MEASURE_CLASS)) synchronize();
    });
    const resize =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(synchronize);
    synchronize();
    resize?.observe(root);
    return () => {
      observer.disconnect();
      resize?.disconnect();
      resetPreviews(root);
    };
  }, [rootRef]);
}

function resetPreviews(root: HTMLElement) {
  root
    .querySelectorAll(`.${PREVIEW_MORE_CLASS}`)
    .forEach((button) => button.remove());
  root.querySelectorAll<HTMLElement>(".tnc-preview-hidden").forEach((item) => {
    item.classList.remove("tnc-preview-hidden");
    item.removeAttribute("inert");
  });
}

export function boundCalendarPreviews(
  root: HTMLElement,
  onInspect: (day: string) => void,
  moreLabel: (count: number) => string,
) {
  root
    .querySelectorAll<HTMLElement>(".tnc-tg-top, .tnc-dg-week")
    .forEach((row) => {
      const layer = row.querySelector<HTMLElement>(
        ".tnc-allday-layer, .tnc-dg-content",
      );
      const more = layer?.querySelector(".tnc-more-layer");
      if (!layer || !more) return;
      if (
        root.classList.contains("is-day") &&
        layer.matches(".tnc-allday-layer")
      )
        return;
      const visibleRows =
        row.matches(".tnc-tg-top") &&
        window.matchMedia?.("(max-width: 839px)").matches &&
        root.querySelector(".tnc--has-strip")
          ? 1
          : 2;
      const overflow = [
        ...layer.querySelectorAll<HTMLElement>(":scope > .tnc-item"),
      ].filter(
        (item) =>
          Number(/(\d+)\s*\*/.exec(item.style.top)?.[1] ?? 0) >= visibleRows,
      );
      if (!overflow.length) return;
      const cells = [
        ...row.querySelectorAll<HTMLElement>(".tnc-dh, .tnc-dg-day"),
      ];
      cells.forEach((cell, index) => {
        const bounds = cell.getBoundingClientRect();
        const center = bounds.left + bounds.width / 2;
        const hidden = overflow.filter((item) => {
          const itemBounds = item.getBoundingClientRect();
          return itemBounds.left < center && itemBounds.right > center;
        });
        if (!hidden.length) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = `tnc-more ${PREVIEW_MORE_CLASS}`;
        button.textContent = moreLabel(hidden.length);
        button.style.left = `calc(${(index / cells.length) * 100}% + 2px)`;
        button.style.width = `calc(${100 / cells.length}% - 4px)`;
        button.style.top = hidden[0]!.style.top;
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          if (cell.dataset.date) onInspect(cell.dataset.date);
        });
        more.append(button);
      });
      overflow.forEach((item) => {
        item.classList.add("tnc-preview-hidden");
        item.setAttribute("inert", "");
      });
    });
}

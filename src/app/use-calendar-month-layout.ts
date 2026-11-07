import { useEffect, useState, type RefObject } from "react";

export function monthDotCapacity(width: number, countWidth: number): number {
  return Math.max(1, Math.floor((width - countWidth) / 8));
}

export function useCalendarMonthLayout(
  root: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  itemCount: number,
) {
  const [layout, setLayout] = useState({ dots: 1, height: 600 });
  useEffect(() => {
    const host = root.current;
    if (!host || !enabled || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const box = host.querySelector<HTMLElement>(".tnc-dg-dots");
      const surface = host.querySelector<HTMLElement>(".full-calendar-surface");
      const count = host.ownerDocument.createElement("span");
      count.className = "tnc-dg-dots-more";
      count.style.cssText =
        "position:fixed;visibility:hidden;white-space:nowrap";
      count.textContent = `+${itemCount}`;
      box?.append(count);
      const dots = box
        ? monthDotCapacity(box.clientWidth, count.getBoundingClientRect().width)
        : 1;
      count.remove();
      const weeks = host.querySelectorAll(".tnc-dg-week").length || 6;
      const height = Math.max(
        weeks * 100 + 32,
        window.innerHeight - (surface?.getBoundingClientRect().top ?? 0) - 24,
      );
      setLayout((current) =>
        current.dots === dots && current.height === height
          ? current
          : { dots, height },
      );
    };
    const observe = () =>
      mutation.observe(host, { childList: true, subtree: true });
    const mutation = new MutationObserver(() => {
      mutation.disconnect();
      measure();
      observe();
    });
    const resize = new ResizeObserver(() => {
      mutation.disconnect();
      measure();
      observe();
    });
    resize.observe(host);
    measure();
    observe();
    window.addEventListener("resize", measure);
    return () => {
      mutation.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [root, enabled, itemCount]);
  return layout;
}

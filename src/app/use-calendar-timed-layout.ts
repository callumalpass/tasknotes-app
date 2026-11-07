import { useEffect, type RefObject } from "react";

export function readableTimedPlacement(
  laneWidth: number,
  leftFraction: number,
  widthFraction: number,
) {
  if (laneWidth <= 0 || widthFraction <= 0 || widthFraction >= 1) return;
  const readableWidth = Math.min(104, laneWidth * 0.75);
  if (laneWidth * widthFraction >= readableWidth) return;
  const left =
    (leftFraction / (1 - widthFraction)) * (laneWidth - readableWidth);
  return { left, width: laneWidth - left - 1 };
}

export function useCalendarTimedLayout(
  root: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const host = root.current;
    if (!host || !enabled) return;
    const measure = () => {
      mutation.disconnect();
      for (const item of host.querySelectorAll<HTMLElement>(
        ".tnc-item--timed",
      )) {
        const width = /([\d.]+)%/.exec(item.style.width);
        const placement = readableTimedPlacement(
          item.parentElement?.clientWidth ?? 0,
          Number.parseFloat(item.style.left) / 100,
          Number(width?.[1] ?? 100) / 100,
        );
        item.toggleAttribute("data-readable-cascade", Boolean(placement));
        if (placement) {
          item.style.setProperty(
            "--calendar-timed-left",
            `${placement.left}px`,
          );
          item.style.setProperty(
            "--calendar-timed-width",
            `${placement.width}px`,
          );
        } else {
          item.style.removeProperty("--calendar-timed-left");
          item.style.removeProperty("--calendar-timed-width");
        }
      }
      mutation.observe(host, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style"],
      });
    };
    const mutation = new MutationObserver(measure);
    const resize =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    resize?.observe(host);
    measure();
    return () => {
      mutation.disconnect();
      resize?.disconnect();
    };
  }, [root, enabled]);
}

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

interface TimedTitleBounds {
  left: number;
  width: number;
  top: number;
  bottom: number;
  titleBottom: number;
}

export function isTimedCascadeSliver(
  item: TimedTitleBounds,
  siblings: readonly TimedTitleBounds[],
) {
  const visibleWidth = siblings.reduce(
    (width, sibling) =>
      sibling.left > item.left &&
      sibling.top < item.titleBottom &&
      sibling.bottom > item.top
        ? Math.min(width, sibling.left - item.left)
        : width,
    item.width,
  );
  return visibleWidth < 48;
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
      const lanes = new Map<HTMLElement, TimedTitleBounds[]>();
      const cascades: Array<{
        element: HTMLElement;
        bounds: TimedTitleBounds;
        lane: HTMLElement;
      }> = [];
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
        item.removeAttribute("data-cascade-sliver");
        if (placement) {
          item.style.setProperty(
            "--calendar-timed-left",
            `${placement.left}px`,
          );
          item.style.setProperty(
            "--calendar-timed-width",
            `${placement.width}px`,
          );
          const lane = item.parentElement!;
          const bounds = {
            ...placement,
            top: item.offsetTop,
            bottom: item.offsetTop + item.offsetHeight,
            titleBottom: item.offsetTop + Math.min(40, item.offsetHeight),
          };
          const siblings = lanes.get(lane) ?? [];
          siblings.push(bounds);
          lanes.set(lane, siblings);
          cascades.push({ element: item, bounds, lane });
        } else {
          item.style.removeProperty("--calendar-timed-left");
          item.style.removeProperty("--calendar-timed-width");
        }
      }
      for (const { element, bounds, lane } of cascades)
        element.toggleAttribute(
          "data-cascade-sliver",
          isTimedCascadeSliver(bounds, lanes.get(lane)!),
        );
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

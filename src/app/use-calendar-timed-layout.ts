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

/** The share of its lane a timed item's `left` or `width` gives: a plain
 * percentage, the calendar's `calc(<inset> + (<lane>) * <fraction>)`, or the
 * browser's simplified form of it, `calc(25% - 1.25px)`. */
export function laneFraction(value: string): number | undefined {
  const factor = /\*\s*([\d.]+)/.exec(value);
  if (factor) return Number(factor[1]);
  const percent = /([\d.]+)%/.exec(value);
  return percent ? Number(percent[1]) / 100 : undefined;
}

/** The lane a timed item is laid out in. Where planned and tracked time
 * overlap, the calendar splits the column: planned items keep to its share
 * left of the tracked strip (`--tnc-actual-w`), tracked items to the strip. */
export function timedLane(
  columnWidth: number,
  left: string,
  actualShare: number | undefined,
  actualLane: boolean,
) {
  if (!left.includes("--tnc-actual-w") || actualShare === undefined)
    return { offset: 0, width: columnWidth };
  const actual = columnWidth * actualShare;
  return actualLane
    ? { offset: columnWidth - actual - 2, width: actual }
    : { offset: 1, width: columnWidth - actual - 5 };
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
        const track = timedLane(
          item.parentElement?.clientWidth ?? 0,
          item.style.left,
          laneFraction(
            getComputedStyle(item).getPropertyValue("--tnc-actual-w"),
          ),
          Boolean(item.parentElement?.classList.contains("tnc-col-actual")),
        );
        const cascade = readableTimedPlacement(
          track.width,
          laneFraction(item.style.left) ?? 0,
          laneFraction(item.style.width) ?? 1,
        );
        const placement = cascade && {
          ...cascade,
          left: track.offset + cascade.left,
        };
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
          item.style.setProperty("--calendar-lane-left", `${track.offset}px`);
          item.style.setProperty(
            "--calendar-lane-width",
            `${track.width - 1}px`,
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
          item.style.removeProperty("--calendar-lane-left");
          item.style.removeProperty("--calendar-lane-width");
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

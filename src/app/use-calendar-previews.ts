import { useEffect, useEffectEvent, type RefObject } from "react";
import { calendarText } from "../i18n/calendar-locale";
import { countLabel } from "../i18n/default-labels";

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
      resetPreviews(root, true);
      boundCalendarPreviews(root, inspect, calendarText().more!);
      boundCalendarCollisions(root, inspect, (count) =>
        countLabel(count, "task"),
      );
      observer.observe(root, { childList: true, subtree: true });
    };
    const observer = new MutationObserver(synchronize);
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

function resetPreviews(root: HTMLElement, preserveCollisions = false) {
  root
    .querySelectorAll(".tnc-preview-more")
    .forEach((button) => button.remove());
  root.querySelectorAll<HTMLElement>(".tnc-preview-hidden").forEach((item) => {
    item.classList.remove("tnc-preview-hidden");
    item.removeAttribute("inert");
  });
  if (!preserveCollisions)
    root
      .querySelectorAll(".calendar-collision-trigger")
      .forEach((button) => button.remove());
  root
    .querySelectorAll<HTMLElement>(".tnc-collision-hidden")
    .forEach((item) => {
      item.classList.remove("tnc-collision-hidden");
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
        button.className = "tnc-more tnc-preview-more";
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

export function boundCalendarCollisions(
  root: HTMLElement,
  onInspect: (day: string) => void,
  countLabel: (count: number) => string,
) {
  root
    .querySelectorAll<HTMLElement>(".tnc-col[data-date]")
    .forEach((column) => {
      column
        .querySelectorAll<HTMLElement>(".tnc-col-plan, .tnc-col-actual")
        .forEach((layer) => {
          const existing = new Map(
            [
              ...layer.querySelectorAll<HTMLButtonElement>(
                ".calendar-collision-trigger",
              ),
            ].map((button) => [button.dataset.collisionKey, button]),
          );
          const events = [
            ...layer.querySelectorAll<HTMLElement>(
              ".tnc-item--timed:not(.is-mirror)",
            ),
          ]
            .map((element) => ({
              element,
              bounds: element.getBoundingClientRect(),
            }))
            .sort((first, second) => first.bounds.top - second.bounds.top);
          let cluster: typeof events = [];
          let end = -Infinity;
          const collapse = () => {
            if (cluster.length < 2) return;
            const key = JSON.stringify(
              cluster.map(
                ({ element }) =>
                  element.dataset.id ?? element.getAttribute("aria-label"),
              ),
            );
            const button =
              existing.get(key) ?? document.createElement("button");
            existing.delete(key);
            if (button.parentElement !== layer) {
              button.type = "button";
              button.className = "calendar-collision-trigger";
              button.dataset.collisionKey = key;
              button.addEventListener("pointerdown", (event) =>
                event.stopPropagation(),
              );
              button.addEventListener("click", (event) => {
                event.stopPropagation();
                if (column.dataset.date) onInspect(column.dataset.date);
              });
              layer.append(button);
            }
            button.textContent = countLabel(cluster.length);
            button.title = cluster
              .map(
                ({ element }) =>
                  element.getAttribute("aria-label") ?? element.textContent,
              )
              .join("\n");
            button.style.top = cluster[0]!.element.style.top;
            cluster.forEach(({ element }) => {
              element.classList.add("tnc-collision-hidden");
              element.setAttribute("inert", "");
            });
          };
          events.forEach((event) => {
            if (event.bounds.top >= end - 1) {
              collapse();
              cluster = [];
            }
            cluster.push(event);
            end = Math.max(
              cluster.length === 1 ? -Infinity : end,
              event.bounds.bottom,
            );
          });
          collapse();
          existing.forEach((button) => button.remove());
        });
    });
}

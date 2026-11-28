import type { ListRowPool, NormalizedItem } from "@tasknotes/calendar";
import type { CalendarEventData } from "./calendar-items";

type Row = NormalizedItem<CalendarEventData>;
type Pool = ListRowPool<CalendarEventData>;
const groupSize = 16;
const estimatedRowHeight = 64;

interface Group {
  host: HTMLDivElement;
  rows: readonly Row[];
  pool: Pool;
  visible: boolean;
  nearby: boolean;
  height: number;
  dragObserver?: MutationObserver;
}

/** Keep the calendar's item store, civil-day ordering and native gesture targets.
 * Only materialize the row pools near the viewport, including the Overdue lead.
 */
export function agendaRowWindow(
  container: HTMLElement,
  create: (host: HTMLElement) => Pool,
  totalItems: () => number,
): Pool {
  const eager = create(container);
  if (typeof IntersectionObserver === "undefined") return eager;
  const groups = new Map<Element, Group>();
  let dayFor: Parameters<Pool["render"]>[1];
  let observer: IntersectionObserver | undefined;
  const observe = (host: HTMLElement) => {
    observer ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const group = groups.get(entry.target);
          if (!group) continue;
          group.nearby = entry.isIntersecting;
          update(group);
        }
      },
      { rootMargin: "900px 0px" },
    );
    observer.observe(host);
  };

  function show(group: Group) {
    group.visible = true;
    group.host.tabIndex = -1;
    group.pool.render(group.rows, dayFor);
    // React fills the native slots after this batch. Keep the reserved space
    // until that commit so a deep scroll never anchors to empty row shells.
    requestAnimationFrame(() => {
      if (group.visible) group.host.style.minHeight = "";
    });
  }
  function update(group: Group) {
    if (group.nearby) {
      if (!group.visible) show(group);
      return;
    }
    if (!group.visible || group.host.contains(document.activeElement)) return;
    const dragging = group.host.querySelector(".is-dragging");
    if (dragging) {
      // A cancelled drag need not redraw or intersect this group again.
      if (!group.dragObserver) {
        group.dragObserver = new MutationObserver(() => update(group));
        group.dragObserver.observe(dragging, {
          attributes: true,
          attributeFilter: ["class"],
        });
      }
      return;
    }
    group.dragObserver?.disconnect();
    group.dragObserver = undefined;
    const height = group.host.getBoundingClientRect().height;
    if (height) group.height = height;
    group.host.style.minHeight = `${group.height}px`;
    group.visible = false;
    group.host.tabIndex = 0;
    group.pool.clear();
  }
  function addGroup(rows: readonly Row[]): Group {
    const host = document.createElement("div");
    host.className = "agenda-row-group";
    host.setAttribute("role", "group");
    const group = {
      host,
      rows,
      pool: create(host),
      visible: false,
      nearby: false,
      height: rows.length * estimatedRowHeight,
    };
    host.style.minHeight = `${group.height}px`;
    host.tabIndex = 0;
    let taskDirection = 0;
    host.addEventListener("tasknotes:focus-agenda-task", (event) => {
      taskDirection = (event as CustomEvent<number>).detail;
      host.focus();
    });
    host.onfocus = (event) => {
      if (event.target !== host) return;
      const tasksOnly = taskDirection !== 0;
      const backward = tasksOnly
        ? taskDirection < 0
        : event.relatedTarget instanceof Element &&
          Boolean(
            host.compareDocumentPosition(event.relatedTarget) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          );
      taskDirection = 0;
      show(group);
      // React publishes the calendar's task controls after the native mount batch.
      requestAnimationFrame(() => {
        if (document.activeElement !== host) return;
        const controls = host.querySelectorAll<HTMLElement>(
          tasksOnly
            ? ".task-row-title"
            : 'button:not(:disabled), [tabindex="0"]',
        );
        controls[backward ? controls.length - 1 : 0]?.focus();
      });
    };
    host.addEventListener("focusout", () =>
      queueMicrotask(() => {
        if (groups.has(host)) update(group);
      }),
    );
    groups.set(host, group);
    container.append(host);
    observe(host);
    return group;
  }
  function remove(group: Group) {
    group.dragObserver?.disconnect();
    observer?.unobserve(group.host);
    group.pool.clear();
    group.host.remove();
    groups.delete(group.host);
  }
  return {
    render(rows, resolveDay) {
      dayFor = resolveDay;
      // A long agenda can also be dense in aggregate across many small days.
      if (
        !rows.length ||
        (rows.length <= groupSize * 2 && totalItems() <= 256)
      ) {
        for (const group of groups.values()) remove(group);
        delete container.dataset.agendaTaskCount;
        eager.render(rows, dayFor);
        return;
      }
      eager.clear();
      container.dataset.agendaTaskCount = String(
        rows.filter(
          ({ item }) =>
            item.data?.metadata &&
            item.data.metadata.entry.modelEntry.type !== "timeEntry",
        ).length,
      );
      const current = [...groups.values()];
      for (let start = 0; start < rows.length; start += groupSize) {
        const slice = rows.slice(start, start + groupSize);
        const group = current[start / groupSize] ?? addGroup(slice);
        group.rows = slice;
        group.host.toggleAttribute(
          "data-agenda-task-rows",
          slice.some((row) => row.item.data?.metadata),
        );
        group.host.setAttribute(
          "aria-label",
          `${slice[0].item.title} – ${slice.at(-1)!.item.title}`,
        );
        if (group.visible) group.pool.render(slice, dayFor);
      }
      for (const group of current.slice(Math.ceil(rows.length / groupSize)))
        remove(group);
    },
    elementsFor(id) {
      return [
        ...eager.elementsFor(id),
        ...[...groups.values()].flatMap((group) =>
          group.visible ? group.pool.elementsFor(id) : [],
        ),
      ];
    },
    clear() {
      observer?.disconnect();
      for (const group of groups.values()) remove(group);
      eager.clear();
    },
  };
}

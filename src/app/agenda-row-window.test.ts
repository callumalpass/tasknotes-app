import { afterEach, expect, it, vi } from "vitest";
import { getTimeZone, ItemStore, type ListRowPool } from "@tasknotes/calendar";
import { agendaRowWindow } from "./agenda-row-window";
import type { CalendarEventData } from "./calendar-items";

const store = new ItemStore<CalendarEventData>(getTimeZone("UTC"));
const rows = Array.from({ length: 73 }, (_, index) =>
  store.normalize({
    id: String(index),
    title: `Task ${index}`,
    start: "2026-11-04",
    data:
      index === 0
        ? ({ google: {} } as CalendarEventData)
        : ({
            metadata: {
              entry: {
                modelEntry: { type: index === 1 ? "timeEntry" : "scheduled" },
              },
            },
          } as CalendarEventData),
  })!,
);
const dayFor = () => rows[0].startDay;
function create(host: HTMLElement): ListRowPool<CalendarEventData> {
  let buttons: HTMLButtonElement[] = [];
  function clear() {
    for (const button of buttons) button.remove();
    buttons = [];
  }
  return {
    render(items) {
      clear();
      buttons = items.map(({ id }) => {
        const button = document.createElement("button");
        button.textContent = id;
        host.append(button);
        return button;
      });
    },
    elementsFor: (id) => buttons.filter((button) => button.textContent === id),
    clear,
  };
}
afterEach(() => vi.unstubAllGlobals());

it("keeps the complete order when observers are unavailable", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const container = document.createElement("div");
  const pool = agendaRowWindow(container, create, () => rows.length);
  pool.render(rows, dayFor);
  expect([...container.children].map((el) => el.textContent)).toEqual(
    rows.map((r) => r.id),
  );
  pool.clear();
  expect(container).toBeEmptyDOMElement();
});

it("recycles native pools, retains the logical task count, and returns to a small eager list after an edit", async () => {
  let intersect: (
    entries: { target: Element; isIntersecting: boolean }[],
  ) => void;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const host = document.createElement("div");
  let total = rows.length;
  const pool = agendaRowWindow(host, create, () => total);
  pool.render(rows, dayFor);
  expect(host.dataset.agendaTaskCount).toBe("71");
  expect(host.querySelectorAll(":scope > button")).toHaveLength(0);
  const first = host.firstElementChild!;
  const last = host.lastElementChild!;
  intersect!([{ target: last, isIntersecting: true }]);
  expect(last.lastElementChild).toHaveTextContent("72");
  expect(pool.elementsFor("72")).toHaveLength(1);
  last.lastElementChild!.classList.add("is-dragging");
  intersect!([
    { target: first, isIntersecting: true },
    { target: last, isIntersecting: false },
  ]);
  expect(pool.elementsFor("72")).toHaveLength(1);
  last.lastElementChild!.classList.remove("is-dragging");
  await Promise.resolve();
  expect(pool.elementsFor("72")).toEqual([]);
  expect(pool.elementsFor("0")).toHaveLength(1);

  pool.render([...rows].reverse(), dayFor);
  expect(first.firstElementChild).toHaveTextContent("72");
  expect(host.firstElementChild).toBe(first);
  pool.render([rows[72], rows[0]], dayFor);
  expect(host.dataset.agendaTaskCount).toBeUndefined();
  expect([...host.children].map((el) => el.textContent)).toEqual(["72", "0"]);
  total = 10000;
  pool.render([rows[0], rows[1]], dayFor);
  expect(host.querySelectorAll("button")).toHaveLength(0);
  expect(host.querySelectorAll(".agenda-row-group")).toHaveLength(1);
  pool.clear();
  expect(host).toBeEmptyDOMElement();
});

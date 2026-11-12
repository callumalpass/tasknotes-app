import { expect, it } from "vitest";
import type { NormalizedItem } from "@tasknotes/calendar";
import type { CalendarEntry } from "../domain/calendar-events";
import type { TaskSummary } from "../domain/task";
import type { TaskViewExecution } from "../domain/view";
import { calendarAgendaOrder, type CalendarEventData } from "./calendar-items";

it("orders overdue calendar rows by the same effective date as daily lists, preserving saved sorts", () => {
  const newer = {
    id: "newer",
    title: "Newer",
    scheduled: "2026-11-03",
  } as TaskSummary;
  const older = {
    id: "older",
    title: "Older",
    scheduled: "2026-11-04",
    due: "2026-10-20",
  } as TaskSummary;
  const execution = {
    view: {},
    rows: [newer, older].map((task) => ({ task, values: {} })),
  } as TaskViewExecution;
  const item = (task: TaskSummary) =>
    ({
      item: {
        data: {
          metadata: {
            entry: {
              task,
              modelEntry: { isOverdueOnToday: true },
            } as CalendarEntry,
          },
        },
      },
    }) as NormalizedItem<CalendarEventData>;
  expect(
    calendarAgendaOrder(execution)(item(newer), item(older)),
  ).toBeGreaterThan(0);
  execution.view.sort = [{ property: "priority", direction: "asc" }];
  expect(calendarAgendaOrder(execution)(item(newer), item(older))).toBeLessThan(
    0,
  );
});

it("leads an agenda day with Google's all-day events, ahead of all-day tasks", () => {
  const execution = { view: {}, rows: [] } as unknown as TaskViewExecution;
  const entry = (google: boolean, allDay = true) =>
    ({
      allDay,
      item: { data: google ? { google: {} } : {} },
    }) as NormalizedItem<CalendarEventData>;
  const order = calendarAgendaOrder(execution, true);
  expect(order(entry(false), entry(true))).toBeGreaterThan(0);
  expect(order(entry(true), entry(false))).toBeLessThan(0);
  // Timed entries keep the calendar's own order, and so does every other mode.
  expect(order(entry(false, false), entry(true, false))).toBe(
    order(entry(false, false), entry(false, false)),
  );
  const elsewhere = calendarAgendaOrder(execution);
  expect(elsewhere(entry(false), entry(true))).toBe(
    elsewhere(entry(false), entry(false)),
  );
});

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

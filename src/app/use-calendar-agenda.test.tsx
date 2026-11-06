import { cleanup, renderHook } from "../test/render";
import { afterEach, expect, it, vi } from "vitest";
import type { Calendar } from "@tasknotes/calendar";
import type { CalendarEntry } from "../domain/calendar-events";
import type { TaskViewExecution } from "../domain/view";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import type { CalendarEventData } from "./calendar-items";
import { useCalendarAgenda } from "./use-calendar-agenda";

const fixture = vi.hoisted(() => ({
  entries: new Map<string, CalendarEntry[]>(),
}));
vi.mock("./use-calendar-entries", () => ({
  useCalendarEntries: () => fixture.entries,
}));
afterEach(cleanup);

it("counts other-day planned deadlines in the strip, excluding tracked time from task counts", () => {
  const model = new TaskNotesTaskModel();
  const task = model.create(
    { title: "Deadline", scheduled: "2026-11-03", due: "2026-11-04" },
    { id: "deadline" },
  );
  const entry = {
    task,
    row: { task, values: {} },
    modelEntry: { allDay: true, isOverdueOnToday: false },
  } as unknown as CalendarEntry;
  fixture.entries = new Map([
    [
      "2026-11-04",
      [
        entry,
        { ...entry, task: { ...task, id: "planned" } },
        { ...entry, timeEntry: {} as NonNullable<CalendarEntry["timeEntry"]> },
      ],
    ],
  ]);
  const root = document.createElement("div");
  root.innerHTML =
    '<button class="tnc-strip-day" data-date="2026-11-04"></button><section class="tnc-list-section"><h2 class="tnc-list-day">November 4</h2><div class="tnc-item--list"></div><div class="tnc-item--list"></div><div class="tnc-item--list is-time-entry"></div></section>';
  const measure = vi.fn();
  const calendar = {
    current: {
      opts: { allDaySlot: true },
      strip: { measure },
    } as unknown as Calendar<CalendarEventData>,
  };
  const { result } = renderHook(() =>
    useCalendarAgenda({
      root: { current: root },
      calendar,
      enabled: true,
      items: [],
      locale: "en",
      execution: {} as TaskViewExecution,
      identityTasks: [task],
      configuration: model.configuration(),
      display: {},
    }),
  );
  expect(root.querySelector(".tnc-strip-day")).toHaveAccessibleName(
    "Wednesday, November 4, 2026, 2 tasks",
  );
  expect(root.querySelector(".agenda-day-count")).toHaveTextContent("2");
  expect(measure).toHaveBeenCalled();
  expect(result.current.stripTitle).toBe("Nov 4");
});

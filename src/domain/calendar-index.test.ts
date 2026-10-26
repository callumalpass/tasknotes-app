import { afterEach, expect, it, vi } from "vitest";
import { AppCalendarEntryIndex, calendarSettings } from "./calendar-events";
import { TaskNotesTaskModel } from "./tasknotes-model";
import type { TaskSummary } from "./task";
import type { TaskViewExecution } from "./view";

const context = { timezone: "America/New_York", now: "2026-03-08T16:00:00Z" };
const range = { start: "2026-03-01", end: "2026-04-01" };
const model = new TaskNotesTaskModel();
afterEach(() => vi.restoreAllMocks());

function view(tasks: TaskSummary[], options = {}): TaskViewExecution {
  return {
    view: {
      key: "calendar",
      documentId: "calendar",
      documentName: "Calendar",
      id: "calendar",
      name: "Calendar",
      properties: [],
      source: {
        path: "calendar.base",
        format: "obsidian.base",
        revision: "1",
        writable: true,
      },
      presentation: { type: "tasknotes.calendar", mappings: {}, options },
    },
    rows: tasks.map((task) => ({ task, values: {} })),
    groups: [],
    hasMore: false,
    totalCount: tasks.length,
  };
}

it("reuses unchanged task expansions across single-record edits, cloned rows and range revisits", () => {
  let reads = 0;
  const convert = TaskNotesTaskModel.prototype.calendarTaskInfo;
  vi.spyOn(TaskNotesTaskModel.prototype, "calendarTaskInfo").mockImplementation(
    function (this: TaskNotesTaskModel, task) {
      const info = convert.call(this, task);
      if (task.id === "series") {
        const scheduled = info.scheduled;
        Object.defineProperty(info, "scheduled", {
          enumerable: true,
          get() {
            reads++;
            return scheduled;
          },
        });
      }
      return info;
    },
  );
  const a = model.create(
    { title: "One task", scheduled: "2026-03-07" },
    { id: "one" },
  );
  const b = model.create(
    {
      title: "Daily",
      scheduled: "2026-03-07T09:00",
      recurrence: "DTSTART:20260307T090000Z;FREQ=DAILY",
    },
    { id: "series" },
  );
  const index = new AppCalendarEntryIndex(model.configuration(), context);
  index.entries(view([a, b]), range, [a, b], context);
  expect(reads).toBeGreaterThan(0);
  const warmed = reads;
  const changed = model.update(a, { scheduled: "2026-03-09" });
  const rows = [changed, { ...b }];
  const result = index.entries(view(rows), range, rows, {
    ...context,
    now: "2026-03-08T17:00:00Z",
  });
  expect(
    result.get("2026-03-09")?.some((entry) => entry.task.id === "one"),
  ).toBe(true);
  expect(reads).toBe(warmed);
  index.entries(view([rows[1], rows[0]]), range, rows, context);
  expect(reads).toBe(warmed);
  const added = model.create(
    { title: "Added", scheduled: "2026-03-10" },
    { id: "added" },
  );
  index.entries(view([...rows, added]), range, [...rows, added], context);
  expect(reads).toBe(warmed);
  index.entries(
    view(rows),
    { start: "2026-04-01", end: "2026-05-01" },
    rows,
    context,
  );
  const secondRange = reads;
  index.entries(view(rows), range, rows, context);
  expect(reads).toBe(secondRange);
  const hidden = index.entries(view(rows), range, rows, {
    ...context,
    settings: { showRecurring: false },
  });
  expect(
    [...hidden.values()]
      .flat()
      .filter((entry) => entry.task.id === "series")
      .map((entry) => entry.modelEntry.type),
  ).toEqual(["scheduled"]);
  index.entries(view([b]), range, [b], context);
  index.clear();
  expect(index.entries(view([]), range, [], context).size).toBe(0);
});

it("groups an implicit all-day entry only on its civil day across spring DST", () => {
  const task = model.create(
    { title: "Sunday", scheduled: "2026-03-08" },
    { id: "sunday" },
  );
  const result = new AppCalendarEntryIndex(
    model.configuration(),
    context,
  ).entries(view([task]), range, [task], context);
  expect([...result.keys()]).toEqual(["2026-03-08"]);
});

it("keeps persisted false options and completed status values, not IDs", () => {
  const configuration = model.configuration();
  const completed = configuration.statuses.find(
    (status) => status.isCompleted,
  )!;
  completed.id = "different-id";
  expect(
    calendarSettings(
      view([], {
        showTimeEntries: false,
        showCompletedRecurringInstances: false,
      }),
      configuration,
      { showTimeEntries: true, calendarView: "listWeek" },
    ),
  ).toMatchObject({
    showTimeEntries: false,
    showCompletedRecurringInstances: false,
    calendarView: "listWeek",
    completedStatuses: expect.arrayContaining([completed.value]),
  });
});

import { expect, it } from "vitest";
import { navigationTaskCounts } from "./navigation-task-counts";
import { TaskNotesTaskModel } from "./tasknotes-model";

it("counts undated open tasks and dated work in the upcoming week without mutating tasks", () => {
  const model = new TaskNotesTaskModel();
  const task = (id: string, overrides = {}) =>
    model.create({ title: id, ...overrides }, { id });
  const tasks = [
    task("undated"),
    task("late", { due: "2026-11-01" }),
    task("next", { scheduled: "2026-11-10" }),
    task("later", { scheduled: "2026-11-11" }),
    { ...task("done"), completed: true },
    { ...task("archived"), archived: true },
  ];
  const before = structuredClone(tasks);
  expect(navigationTaskCounts(tasks, "2026-11-04")).toEqual({
    unplanned: 1,
    upcoming: 2,
  });
  expect(tasks).toEqual(before);
});

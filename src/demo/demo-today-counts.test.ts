import { expect, it } from "vitest";

import { DemoTaskRepository } from "./demo-task-repository";

it("recounts after a day change or edit and subtracts each hidden task once", async () => {
  const repository = new DemoTaskRepository(1);
  const id = "demo-planning-session";
  await repository.update(id, { scheduled: "2030-03-10", due: "2030-03-10" });
  expect(repository.todayTaskCounts("2030-03-09")).toEqual({
    total: 0,
    overdue: 0,
  });
  expect(repository.todayTaskCounts("2030-03-10")).toEqual({
    total: 1,
    overdue: 0,
  });
  expect(repository.todayTaskCounts("2030-03-11", [id, id, "missing"])).toEqual(
    { total: 0, overdue: 0 },
  );
  expect(repository.todayTaskCounts("2030-03-11")).toEqual({
    total: 1,
    overdue: 1,
  });
  await repository.delete(id);
  expect(repository.todayTaskCounts("2030-03-11")).toEqual({
    total: 0,
    overdue: 0,
  });
});

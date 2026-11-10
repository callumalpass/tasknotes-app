import "fake-indexeddb/auto";

import { expect, it } from "vitest";

import { nextTaskFixture } from "../test/next-task-fixture";

it("reports running timers from loaded metadata as they start and stop", async () => {
  const { repository } = await nextTaskFixture();
  // Nothing is known, and nothing is read, until the index has loaded once.
  expect(repository.runningTimers()).toBeNull();
  await repository.initialize();
  const task = await repository.create({ title: "Timed" });
  await repository.create({ title: "Idle" });
  expect(repository.runningTimers()).toEqual([]);

  const started = await repository.startTimeTracking(task.id);
  expect(repository.runningTimers()).toEqual([
    {
      id: task.id,
      title: "Timed",
      startTime: started.timeEntries.at(-1)!.startTime,
    },
  ]);

  await repository.stopTimeTracking(task.id);
  expect(repository.runningTimers()).toEqual([]);
});

import { describe, expect, it } from "vitest";

import { runningTimers } from "./running-timers";

import type { TaskSummary } from "./task";

function task(id: string, entries: TaskSummary["timeEntries"]): TaskSummary {
  return { id, title: `Task ${id}`, timeEntries: entries } as TaskSummary;
}

describe("runningTimers", () => {
  it("keeps only tasks with an open entry, most recently started first", () => {
    expect(
      runningTimers([
        task("closed", [
          {
            startTime: "2026-11-11T08:00:00.000Z",
            endTime: "2026-11-11T09:00:00.000Z",
          },
        ]),
        task("earlier", [{ startTime: "2026-11-11T09:00:00.000Z" }]),
        task("none", []),
        task("later", [
          {
            startTime: "2026-11-10T09:00:00.000Z",
            endTime: "2026-11-10T10:00:00.000Z",
          },
          { startTime: "2026-11-11T10:30:00.000Z" },
        ]),
      ]),
    ).toEqual([
      {
        id: "later",
        title: "Task later",
        startTime: "2026-11-11T10:30:00.000Z",
      },
      {
        id: "earlier",
        title: "Task earlier",
        startTime: "2026-11-11T09:00:00.000Z",
      },
    ]);
  });
});

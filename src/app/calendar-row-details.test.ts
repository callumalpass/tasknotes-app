import { afterEach, expect, it, vi } from "vitest";
import { AppCalendarEntryIndex } from "../domain/calendar-events";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import type { TaskViewExecution } from "../domain/view";
import { calendarRowDetails } from "./calendar-row-details";

afterEach(() => vi.unstubAllEnvs());

it("keeps the project and other-day deadline, without repeating a timed section's local day", () => {
  vi.stubEnv("TZ", "Australia/Melbourne");
  const model = new TaskNotesTaskModel();
  const task = model.create(
    {
      title: "Morning review",
      scheduled: "2026-11-04T22:00:00Z",
      due: "2026-11-07",
      projects: ["[[Projects/operations|Operations]]"],
    },
    { id: "review" },
  );
  const execution: TaskViewExecution = {
    view: {
      key: "custom",
      id: "ordinal-7",
      documentId: "custom",
      documentName: "Custom",
      name: "Custom",
      source: {
        path: "custom.base",
        format: "obsidian.base",
        revision: "1",
        writable: true,
      },
      properties: [{ key: "scheduled" }, { key: "due" }, { key: "status" }],
    },
    rows: [
      {
        task,
        values: {
          scheduled: task.scheduled,
          due: task.due,
          status: task.status,
        },
      },
    ],
    groups: [],
    hasMore: false,
    totalCount: 1,
  };
  const context = {
    timezone: "Australia/Melbourne",
    now: "2026-11-04T00:00:00Z",
  };
  const entries = new AppCalendarEntryIndex(
    model.configuration(),
    context,
  ).entries(
    execution,
    { start: "2026-11-04", end: "2026-11-09" },
    [task],
    context,
  );
  const entry = entries.get("2026-11-05")![0]!;
  const details = calendarRowDetails(
    entry,
    execution,
    "title",
    model.configuration(),
    "2026-11-05",
  );
  expect(details.map((detail) => detail.key)).toEqual([
    "due",
    "status",
    "projects",
  ]);
  expect(details.find((detail) => detail.key === "projects")?.value).toBe(
    "Operations",
  );
  expect(details.find((detail) => detail.key === "due")?.rawValue).toBe(
    "2026-11-07",
  );
  expect(
    calendarRowDetails(entry, execution, "title", model.configuration()).some(
      (detail) => detail.key === "scheduled",
    ),
  ).toBe(true);
  const deadline = entries.get("2026-11-07")![0]!;
  expect(
    calendarRowDetails(
      deadline,
      execution,
      "title",
      model.configuration(),
      "2026-11-07",
    ).find((detail) => detail.key === "due")?.rawValue,
  ).toBe("2026-11-07");
});

it("hides the internal task marker tag from calendar row details while keeping user tags", () => {
  const model = new TaskNotesTaskModel();
  const task = model.create(
    {
      title: "Tagged event",
      scheduled: "2026-11-05",
      tags: ["task", "ops"],
    },
    { id: "tagged" },
  );
  const execution: TaskViewExecution = {
    view: {
      key: "custom",
      id: "ordinal-8",
      documentId: "custom",
      documentName: "Custom",
      name: "Custom",
      source: {
        path: "custom.base",
        format: "obsidian.base",
        revision: "1",
        writable: true,
      },
      properties: [{ key: "tags" }],
    },
    rows: [
      {
        task,
        values: { tags: ["task", "ops"] },
      },
    ],
    groups: [],
    hasMore: false,
    totalCount: 1,
  };
  const context = {
    timezone: "UTC",
    now: "2026-11-05T00:00:00Z",
  };
  const entry = new AppCalendarEntryIndex(model.configuration(), context)
    .entries(
      execution,
      { start: "2026-11-04", end: "2026-11-06" },
      [task],
      context,
    )
    .get("2026-11-05")![0]!;
  const details = calendarRowDetails(
    entry,
    execution,
    "title",
    model.configuration(),
  );
  expect(details.find((detail) => detail.key === "tags")).toMatchObject({
    value: "ops",
    rawValue: ["ops"],
  });
});

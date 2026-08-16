import { describe, expect, it } from "vitest";

import { planRecurringCalendarDrop } from "./calendar-recurrence-drag";

import type { Task } from "./task";

describe("recurring calendar drag planning", () => {
  it("updates only the concrete field for the next scheduled occurrence", () => {
    expect(
      planRecurringCalendarDrop(task(), {
        occurrenceDate: "2026-08-17",
        recurringKind: "next-scheduled",
        dateField: "scheduled",
        start: new Date(2026, 7, 18, 11, 30),
        allDay: false,
      }),
    ).toEqual({ scheduled: "2026-08-18T11:30" });
  });

  it("preserves DTSTART's date while changing the pattern time", () => {
    expect(
      planRecurringCalendarDrop(task(), {
        occurrenceDate: "2026-08-24",
        recurringKind: "pattern",
        dateField: "scheduled",
        start: new Date(2026, 7, 25, 14, 45),
        allDay: false,
      }),
    ).toEqual({
      recurrence: "DTSTART:20260817T144500Z;FREQ=WEEKLY;BYDAY=MO",
      preserveRecurrenceSchedule: true,
    });
  });

  it("supports equals-form DTSTART and all-day pattern drops", () => {
    expect(
      planRecurringCalendarDrop(
        task({
          recurrence: "FREQ=WEEKLY;BYDAY=MO;DTSTART=20260817T090000Z",
        }),
        {
          occurrenceDate: "2026-08-24",
          recurringKind: "pattern",
          dateField: "scheduled",
          start: new Date(2026, 7, 26),
          allDay: true,
        },
      ),
    ).toEqual({
      recurrence: "FREQ=WEEKLY;BYDAY=MO;DTSTART=20260817",
      preserveRecurrenceSchedule: true,
    });
  });

  it("adds DTSTART from the concrete schedule when the rule omits it", () => {
    expect(
      planRecurringCalendarDrop(task({ recurrence: "FREQ=WEEKLY;BYDAY=MO" }), {
        occurrenceDate: "2026-08-24",
        recurringKind: "pattern",
        dateField: "scheduled",
        start: new Date(2026, 7, 25, 16, 5),
        allDay: false,
      }),
    ).toEqual({
      recurrence: "DTSTART:20260817T160500Z;FREQ=WEEKLY;BYDAY=MO",
      preserveRecurrenceSchedule: true,
    });
  });
});

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "weekly",
    path: "tasks/weekly.md",
    title: "Weekly planning",
    status: "open",
    completed: false,
    archived: false,
    priority: "normal",
    scheduled: "2026-08-17T09:00",
    body: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    tags: ["task"],
    contexts: [],
    projects: [],
    attachments: [],
    blockedBy: [],
    recurrence: "DTSTART:20260817T090000Z;FREQ=WEEKLY;BYDAY=MO",
    completeInstances: [],
    skippedInstances: [],
    reminders: [],
    timeEntries: [],
    customProperties: {},
    revision: 1,
    frontmatter: {},
    ...overrides,
  };
}

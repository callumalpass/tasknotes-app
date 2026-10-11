import { describe, expect, it } from "vitest";

import {
  calendarEntryKind,
  calendarPriorityLegend,
  calendarPriorityMarker,
  withPendingMoves,
  withPriorityDetail,
} from "./calendar-event-presentation";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";

import type { TaskSummary } from "../domain/task";

const configuration = defaultTaskCollectionConfiguration();

function task(priority: string, completed = false): TaskSummary {
  return { priority, completed } as TaskSummary;
}

describe("calendar priority markers", () => {
  it("marks only priorities above the collection default", () => {
    expect(calendarPriorityMarker(task("high"), configuration)).toEqual({
      value: "high",
      label: "High priority",
      color: "#ff0000",
    });
    for (const priority of ["normal", "low", "none"])
      expect(calendarPriorityMarker(task(priority), configuration)).toBe(
        undefined,
      );
    expect(calendarPriorityMarker(task("high", true), configuration)).toBe(
      undefined,
    );
  });

  it("lists each marker once, highest priority first", () => {
    const custom = {
      ...configuration,
      priorities: [
        ...configuration.priorities,
        {
          id: "urgent",
          value: "urgent",
          label: "Urgent",
          color: "#a00",
          weight: 9,
        },
      ],
    };
    const high = calendarPriorityMarker(task("high"), custom);
    const urgent = calendarPriorityMarker(task("urgent"), custom);
    expect(
      calendarPriorityLegend([high, undefined, urgent, high], custom).map(
        (marker) => marker.label,
      ),
    ).toEqual(["Urgent priority", "High priority"]);
  });

  it("names an elevated priority in words unless the view already shows it", () => {
    const marker = calendarPriorityMarker(task("high"), configuration);
    const scheduled = {
      key: "scheduled",
      label: "Scheduled",
      value: "Today",
      rawValue: "2026-07-24",
    };
    expect(
      withPriorityDetail([scheduled], marker, configuration).map(
        (detail) => `${detail.label} ${detail.value}`,
      ),
    ).toEqual(["Scheduled Today", "Priority High"]);
    const shown = {
      key: "note.priority",
      label: "Priority",
      value: "high",
      rawValue: "high",
    };
    expect(withPriorityDetail([shown], marker, configuration)).toEqual([shown]);
    expect(withPriorityDetail([scheduled], undefined, configuration)).toEqual([
      scheduled,
    ]);
  });
});

describe("calendar entry kind", () => {
  const due = { key: "due", label: "Due", value: "Tomorrow", rawValue: "x" };

  it("drops the Due label where the shown details already say when", () => {
    expect(calendarEntryKind("Due", [due], true, configuration)).toBe(
      undefined,
    );
    expect(
      calendarEntryKind(
        "Due",
        [{ ...due, key: 'note["due"]' }],
        true,
        configuration,
      ),
    ).toBe(undefined);
  });

  it("keeps it where details are hidden or say nothing about the due date", () => {
    expect(calendarEntryKind("Due", [due], false, configuration)).toBe("Due");
    expect(calendarEntryKind("Due", [], true, configuration)).toBe("Due");
    expect(calendarEntryKind("Tracked time", [], true, configuration)).toBe(
      "Tracked time",
    );
  });
});

describe("pending calendar moves", () => {
  const event = { id: "a", start: "2026-07-24T09:00", end: "2026-07-24T10:00" };

  it("keeps a dropped event at its new place until newer view data arrives", () => {
    const before = {};
    const after = {};
    const moves = new Map([["a", { start: "2026-07-27", allDay: true }]]);
    expect(withPendingMoves([event], moves, before)).toEqual([
      { id: "a", start: "2026-07-27", allDay: true },
    ]);
    const settled = new Map([
      ["a", { start: "2026-07-27", allDay: true, settledWith: before }],
    ]);
    expect(withPendingMoves([event], settled, before)[0]?.start).toBe(
      "2026-07-27",
    );
    expect(withPendingMoves([event], settled, after)).toEqual([event]);
  });
});

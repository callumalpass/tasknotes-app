import { describe, expect, it } from "vitest";

import {
  calendarDateDefaults,
  calendarSelectionDefaults,
} from "./mini-calendar";

import type { TaskView } from "./view";

describe("calendar creation defaults", () => {
  it("prefers scheduled dates and preserves a timed selection duration", () => {
    expect(
      calendarSelectionDefaults(calendarView(), "2026-08-17T09:30", 45),
    ).toEqual({ scheduled: "2026-08-17T09:30", timeEstimate: 45 });
  });

  it("uses due when scheduled events are hidden", () => {
    expect(
      calendarDateDefaults(
        calendarView({ showScheduled: false }),
        "2026-08-17",
      ),
    ).toEqual({ due: "2026-08-17" });
  });

  it("does not attach a duration to an all-day selection", () => {
    expect(
      calendarSelectionDefaults(calendarView(), "2026-08-17", 1_440),
    ).toEqual({ scheduled: "2026-08-17" });
  });
});

function calendarView(options: Record<string, unknown> = {}): TaskView {
  return {
    key: "calendar#default",
    documentId: "calendar",
    documentName: "Calendar",
    id: "default",
    name: "Calendar",
    properties: [],
    source: {
      path: "views/calendar.base",
      format: "obsidian.base",
      revision: "one",
      writable: true,
    },
    presentation: {
      type: "tasknotes.calendar",
      mappings: {},
      options,
    },
  };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { scheduleSummary, toDraft } from "./task-editor-draft";

afterEach(() => vi.useRealTimers());

describe("task schedule summary", () => {
  it("shows the selected occurrence dates without changing the series draft", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 12));
    const task = new TaskNotesTaskModel().create(
      {
        title: "Review",
        scheduled: "2026-10-14",
        due: "2026-10-16",
        recurrence: "DTSTART:20261014;FREQ=WEEKLY;BYDAY=WE",
      },
      { id: "review", now: "2026-10-13T16:00:00Z" },
    );
    const draft = toDraft(task);
    expect(
      scheduleSummary(
        task,
        draft,
        defaultTaskCollectionConfiguration(),
        "2026-10-21",
      ),
    ).toBe("Scheduled Oct 21 · Due Oct 23");
    expect(draft.scheduled).toBe("2026-10-14");
    expect(draft.due).toBe("2026-10-16");
    expect(
      scheduleSummary(task, draft, defaultTaskCollectionConfiguration()),
    ).toBe("Scheduled Today · Due Fri");
  });
});

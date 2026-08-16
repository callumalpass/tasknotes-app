import "fake-indexeddb/auto";

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RepositoryProvider } from "./repository-context";
import { useCalendarMutations } from "./use-calendar-mutations";
import { createTestMdbaseRepository } from "../test/mdbase-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { dateFromStorage, todayString } from "../domain/task";

import type { ReactNode } from "react";
import type { TaskView } from "../domain/view";

describe("calendar mutations", () => {
  it("materializes and moves one recurring occurrence without shifting the series", async () => {
    const repository = createTestMdbaseRepository();
    await repository.initialize();
    const parent = await repository.create({
      title: "Weekly planning",
      scheduled: "2026-08-17T09:00",
      recurrence: "FREQ=WEEKLY;BYDAY=MO;DTSTART=20260817",
    });
    const onRefresh = vi.fn();
    const { result } = renderHook(
      () => useCalendarMutations(calendarView(), onRefresh, vi.fn()),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <RepositoryProvider
            mutationJournal={new MemoryMutationJournal()}
            repository={repository}
          >
            {children}
          </RepositoryProvider>
        ),
      },
    );

    let occurrenceId = "";
    await act(async () => {
      const occurrence = await result.current.updateOccurrence(
        parent,
        "2026-08-24",
        { scheduled: "2026-08-25T11:30" },
      );
      occurrenceId = occurrence.id;
    });

    const tasks = await repository.list({ status: "all" });
    expect(tasks.find(({ id }) => id === parent.id)?.scheduled).toBe(
      parent.scheduled,
    );
    const moved = tasks.find(({ id }) => id === occurrenceId);
    expect(moved).toMatchObject({
      occurrenceDate: "2026-08-24",
    });
    const movedDate = dateFromStorage(moved?.scheduled ?? "");
    expect(movedDate && todayString(movedDate)).toBe("2026-08-25");
    expect(movedDate?.getHours()).toBe(11);
    expect(movedDate?.getMinutes()).toBe(30);
    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });
});

function calendarView(): TaskView {
  return {
    key: "views/calendar.base#calendar",
    documentId: "calendar",
    documentName: "Calendar",
    id: "calendar",
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
      options: {},
    },
  };
}

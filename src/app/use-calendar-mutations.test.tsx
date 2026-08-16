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
  it("reschedules the concrete next recurring item without materializing it", async () => {
    const repository = createTestMdbaseRepository();
    await repository.initialize();
    const parent = await repository.create({
      title: "Weekly planning",
      scheduled: "2026-08-17T09:00",
      recurrence: "DTSTART:20260817T090000Z;FREQ=WEEKLY;BYDAY=MO",
    });
    const onRefresh = vi.fn();
    const { result } = renderHook(
      () => useCalendarMutations(calendarView(), onRefresh, vi.fn()),
      { wrapper: repositoryWrapper(repository) },
    );

    await act(async () => {
      await result.current.updateOccurrence(parent, {
        occurrenceDate: "2026-08-17",
        recurringKind: "next-scheduled",
        dateField: "scheduled",
        start: new Date(2026, 7, 18, 11, 30),
        allDay: false,
      });
    });

    const tasks = await repository.list({ status: "all" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: parent.id,
      recurrence: parent.recurrence,
    });
    const scheduled = dateFromStorage(tasks[0].scheduled ?? "");
    expect(scheduled && todayString(scheduled)).toBe("2026-08-18");
    expect(scheduled?.getHours()).toBe(11);
    expect(scheduled?.getMinutes()).toBe(30);
    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("moves a virtual pattern by changing DTSTART time, not scheduled or notes", async () => {
    const repository = createTestMdbaseRepository();
    await repository.initialize();
    const parent = await repository.create({
      title: "Weekly planning",
      scheduled: "2026-08-17T09:00",
      due: "2026-08-18T10:00",
      recurrence: "DTSTART:20260817T090000Z;FREQ=WEEKLY;BYDAY=MO",
    });
    const { result } = renderHook(
      () => useCalendarMutations(calendarView(), vi.fn(), vi.fn()),
      { wrapper: repositoryWrapper(repository) },
    );

    await act(async () => {
      await result.current.updateOccurrence(parent, {
        occurrenceDate: "2026-08-24",
        recurringKind: "pattern",
        dateField: "scheduled",
        start: new Date(2026, 7, 25, 14, 45),
        allDay: false,
      });
    });

    const tasks = await repository.list({ status: "all" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: parent.id,
      scheduled: parent.scheduled,
      due: parent.due,
      recurrence: "DTSTART:20260817T144500Z;FREQ=WEEKLY;BYDAY=MO",
    });
  });
});

function repositoryWrapper(
  repository: ReturnType<typeof createTestMdbaseRepository>,
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        {children}
      </RepositoryProvider>
    );
  };
}

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

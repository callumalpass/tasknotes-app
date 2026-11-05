import "fake-indexeddb/auto";

import { act, renderHook } from "../test/render";
import { describe, expect, it, vi } from "vitest";

import { RepositoryProvider } from "./repository-context";
import { useCalendarMutations } from "./use-calendar-mutations";
import { nextTaskFixture } from "../test/next-task-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { buildCalendarEntries } from "@tasknotes/model/calendar";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { dateFromStorage, todayString } from "../domain/task";

import type { ReactNode } from "react";
import type { NextTaskRepository } from "../storage/next-repository";
import type { TaskView, TaskViewExecution } from "../domain/view";

describe("calendar mutations", () => {
  it("reschedules the concrete next recurring item without materializing it", async () => {
    const { repository } = await nextTaskFixture();
    await repository.initialize();
    const parent = await repository.create({
      title: "Weekly planning",
      scheduled: "2026-08-17T09:00",
      recurrence: "DTSTART:20260817T090000Z;FREQ=WEEKLY;BYDAY=MO",
    });
    // The memory replica does not execute native Bases; the hook's job is to
    // re-run the view after the edit and hand its result back.
    const execution = { tasks: [] } as unknown as TaskViewExecution;
    const executeView = vi
      .spyOn(repository, "executeView")
      .mockResolvedValue(execution);
    const onRefresh = vi.fn();
    const { result } = renderHook(
      () => useCalendarMutations(calendarView(), onRefresh, vi.fn()),
      { wrapper: repositoryWrapper(repository) },
    );

    await act(async () => {
      await result.current.edit(parent, {
        entry: entryFor(parent, "2026-08-17"),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        change: {
          kind: "drop",
          start: new Date(2026, 7, 18, 11, 30).toISOString(),
          allDay: false,
        },
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
    expect(executeView).toHaveBeenCalledWith(calendarView());
    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledWith(execution));
  });

  it("moves a virtual pattern by changing DTSTART time, not scheduled or notes", async () => {
    const { repository } = await nextTaskFixture();
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
      await result.current.edit(parent, {
        entry: entryFor(parent, "2026-08-24"),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        change: {
          kind: "drop",
          start: new Date(2026, 7, 25, 14, 45).toISOString(),
          allDay: false,
        },
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

function repositoryWrapper(repository: NextTaskRepository) {
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

function entryFor(task: import("../domain/task").Task, day: string) {
  return buildCalendarEntries({
    tasks: [new TaskNotesTaskModel().taskInfo(task)],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    now: "2026-08-01T00:00:00Z",
    range: { start: day, end: day.slice(0, 7) + "-28" },
  }).find((entry) => entry.instanceDate === day)!;
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

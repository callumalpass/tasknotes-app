import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { TaskCalendarView } from "./task-calendar-view";
import { defaultCalendarPreferences } from "./calendar-preferences";

import type { CalendarItem } from "@tasknotes/calendar";
import type { Task, TaskSummary } from "../domain/task";
import type { TaskViewExecution } from "../domain/view";

// The calendar does not lay out in jsdom; the test drives the props the view
// hands it, which is where a dropped item's dates come from.
const calendar = vi.hoisted(() => ({
  props: undefined as undefined | Record<string, unknown>,
}));
vi.mock("@tasknotes/calendar/react", () => ({
  TaskCalendar: (props: Record<string, unknown>) => {
    calendar.props = props;
    return null;
  },
}));
vi.mock("./repository-context", async () => {
  const { defaultTaskCollectionConfiguration } =
    await import("../domain/task-configuration");
  const configuration = defaultTaskCollectionConfiguration();
  return { useRepository: () => ({ configuration }) };
});

afterEach(() => {
  cleanup();
  calendar.props = undefined;
});

describe("calendar drops", () => {
  it("keeps a dropped task at its new date while the write is pending", async () => {
    const write = deferred();
    const onUpdate = vi.fn(() => write.promise);
    const original = execution("2026-07-24");
    const view = renderCalendar(original, onUpdate);
    const revert = vi.fn();

    drop("2026-07-24", "2026-07-27", revert);
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "one" }),
      expect.objectContaining({
        entry: expect.objectContaining({ id: "scheduled-one" }),
        change: expect.objectContaining({ kind: "drop", allDay: true }),
      }),
    );
    expect(eventStart()).toBe("2026-07-27");

    // An unrelated re-render while the write is pending must not hand the
    // calendar the old date again.
    view.rerender(original, [{ ...task("2026-07-24") }]);
    expect(eventStart()).toBe("2026-07-27");

    await act(async () => write.resolve());
    expect(eventStart()).toBe("2026-07-27");
    view.rerender(execution("2026-07-27"));
    expect(eventStart()).toBe("2026-07-27");
    expect(revert).not.toHaveBeenCalled();
  });

  it("returns the task to its old date when the write fails", async () => {
    const write = deferred();
    const view = renderCalendar(execution("2026-07-24"), () => write.promise);
    const revert = vi.fn();

    drop("2026-07-24", "2026-07-27", revert);
    expect(eventStart()).toBe("2026-07-27");
    await act(async () => write.reject(new Error("offline")));
    expect(revert).toHaveBeenCalled();
    expect(eventStart()).toBe("2026-07-24");
    expect(view.container.querySelector('[role="alert"]')?.textContent).toMatch(
      /offline/,
    );
  });

  it("writes timed moves and resizes in the stored date formats", async () => {
    const onUpdate = vi.fn(() => Promise.resolve());
    renderCalendar(execution("2026-07-24T09:30", 60), onUpdate);
    const item = items().find((candidate) => candidate.id === "scheduled-one")!;
    expect(item).toMatchObject({
      start: "2026-07-24T09:30",
      end: "2026-07-24T10:30",
      allDay: false,
    });

    change("onItemDrop", item, {
      start: new Date(2026, 6, 27, 14, 15),
      end: new Date(2026, 6, 27, 15, 15),
      startStr: "2026-07-27T14:15",
      endStr: "2026-07-27T15:15",
      allDay: false,
    });
    expect(onUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "one" }),
      expect.objectContaining({
        change: {
          kind: "drop",
          start: new Date(2026, 6, 27, 14, 15).toISOString(),
          end: new Date(2026, 6, 27, 15, 15).toISOString(),
          allDay: false,
        },
      }),
    );

    change("onItemResize", item, {
      start: new Date(2026, 6, 24, 9, 30),
      end: new Date(2026, 6, 24, 11, 0),
      startStr: "2026-07-24T09:30",
      endStr: "2026-07-24T11:00",
      allDay: false,
    });
    expect(onUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "one" }),
      expect.objectContaining({
        change: {
          kind: "resize",
          start: new Date(2026, 6, 24, 9, 30).toISOString(),
          end: new Date(2026, 6, 24, 11, 0).toISOString(),
          allDay: false,
        },
      }),
    );
    await act(async () => {});
  });
});

function items(): CalendarItem[] {
  return (calendar.props?.items ?? []) as CalendarItem[];
}

function eventStart() {
  return items().find((item) => item.id === "scheduled-one")?.start;
}

function drop(_from: string, to: string, revert: () => void) {
  const item = items().find((candidate) => candidate.id === "scheduled-one")!;
  const [year, month, day] = to.split("-").map(Number);
  change(
    "onItemDrop",
    item,
    {
      start: new Date(year!, month! - 1, day),
      end: new Date(year!, month! - 1, day! + 1),
      startStr: to,
      endStr: to,
      allDay: true,
    },
    revert,
  );
}

function change(
  handler: "onItemDrop" | "onItemResize",
  item: CalendarItem,
  next: {
    start: Date;
    end: Date;
    startStr: string;
    endStr: string;
    allDay: boolean;
  },
  revert: () => void = vi.fn(),
) {
  const oldStart = new Date(String(item.start));
  act(() => {
    (calendar.props![handler] as (info: unknown) => void)({
      item,
      ...next,
      oldStart,
      oldAllDay: item.allDay,
      delta: next.start.getTime() - oldStart.getTime(),
      source: "pointer",
      revert,
    });
  });
}

function renderCalendar(
  initial: TaskViewExecution,
  onUpdate: (task: TaskSummary, input: unknown) => Promise<unknown>,
) {
  const element = (
    current: TaskViewExecution,
    identityTasks: TaskSummary[] = current.rows.map((row) => row.task),
  ) => (
    <TaskCalendarView
      execution={current}
      identityTasks={identityTasks}
      preferences={defaultCalendarPreferences("en-US")}
      selected="2026-07-01"
      selectedCreateValue="2026-07-01"
      titleProperty="title"
      onCreate={vi.fn()}
      onOpen={vi.fn()}
      onSelect={vi.fn()}
      onToggle={vi.fn()}
      onEdit={onUpdate as never}
    />
  );
  const result = render(element(initial));
  return {
    container: result.container,
    rerender: (current: TaskViewExecution, identityTasks?: TaskSummary[]) =>
      result.rerender(element(current, identityTasks)),
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function execution(
  scheduled: string,
  timeEstimate?: number,
): TaskViewExecution {
  return {
    view: {
      key: "views/tasks.base#calendar",
      documentId: "tasks",
      documentName: "Tasks",
      id: "calendar",
      name: "Calendar",
      properties: [],
      source: {
        path: "views/tasks.base",
        format: "obsidian.base",
        revision: "one",
        writable: true,
      },
      presentation: {
        type: "tasknotes.calendar",
        mappings: {},
        options: { calendarView: "dayGridMonth" },
      },
    },
    rows: [
      {
        task: {
          ...task(scheduled),
          timeEstimate,
          frontmatter: { ...task(scheduled).frontmatter, timeEstimate },
        },
        values: {},
      },
    ],
    totalCount: 1,
    hasMore: false,
    groups: [],
  };
}

function task(scheduled: string): Task {
  return new TaskNotesTaskModel().read({
    path: "tasks/one.md",
    body: "",
    frontmatter: {
      id: "one",
      title: "Calendar task",
      status: "open",
      scheduled,
      priority: "normal",
      dateCreated: "2026-07-01T00:00:00Z",
      dateModified: "2026-07-01T00:00:00Z",
    },
  });
}

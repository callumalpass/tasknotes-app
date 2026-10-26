import { act, cleanup, render } from "../test/render";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FullCalendarView } from "./full-calendar-view";
import { defaultCalendarPreferences } from "./calendar-preferences";

import type { EventInput } from "@fullcalendar/core";
import type { Task, TaskSummary } from "../domain/task";
import type { TaskViewExecution } from "../domain/view";

// FullCalendar itself does not lay out in jsdom; the test drives the props
// the view hands it, which is where a dropped event's dates come from.
const calendar = vi.hoisted(() => ({
  props: undefined as undefined | Record<string, unknown>,
}));
vi.mock("@fullcalendar/react", () => ({
  default: (props: Record<string, unknown>) => {
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

    drop("2026-07-24", new Date(2026, 6, 27), revert);
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "one" }),
      { scheduled: "2026-07-27" },
    );
    expect(eventStart()).toBe("2026-07-27");

    // An unrelated re-render while the write is pending must not hand
    // FullCalendar the old date again.
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

    drop("2026-07-24", new Date(2026, 6, 27), revert);
    expect(eventStart()).toBe("2026-07-27");
    await act(async () => write.reject(new Error("offline")));
    expect(revert).toHaveBeenCalled();
    expect(eventStart()).toBe("2026-07-24");
    expect(view.container.querySelector('[role="alert"]')?.textContent).toMatch(
      /offline/,
    );
  });
});

function events(): EventInput[] {
  return (calendar.props?.events ?? []) as EventInput[];
}

function eventStart() {
  return events().find((event) => String(event.id).startsWith("one"))?.start;
}

function drop(from: string, start: Date, revert: () => void) {
  const event = events().find(
    (candidate) => candidate.id === `one:scheduled:${from}`,
  )!;
  act(() => {
    (calendar.props!.eventDrop as (info: unknown) => void)({
      event: {
        id: event.id,
        start,
        end: null,
        allDay: true,
        extendedProps: event.extendedProps,
      },
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
    <FullCalendarView
      execution={current}
      identityTasks={identityTasks}
      preferences={defaultCalendarPreferences("en-US")}
      selected="2026-07-01"
      selectedCreateValue="2026-07-01"
      titleProperty="title"
      onCreate={vi.fn()}
      onOpen={vi.fn()}
      onReplaceTimeEntries={vi.fn()}
      onSelect={vi.fn()}
      onToggle={vi.fn()}
      onUpdate={onUpdate as never}
      onUpdateOccurrence={vi.fn()}
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

function execution(scheduled: string): TaskViewExecution {
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
    rows: [{ task: task(scheduled), values: {} }],
    totalCount: 1,
    hasMore: false,
    groups: [],
  };
}

function task(scheduled: string): Task {
  return {
    id: "one",
    path: "tasks/one.md",
    title: "Calendar task",
    status: "open",
    completed: false,
    archived: false,
    priority: "normal",
    scheduled,
    body: "",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    tags: ["task"],
    contexts: [],
    projects: [],
    attachments: [],
    blockedBy: [],
    completeInstances: [],
    skippedInstances: [],
    reminders: [],
    timeEntries: [],
    customProperties: {},
    revision: 1,
    frontmatter: {},
  };
}

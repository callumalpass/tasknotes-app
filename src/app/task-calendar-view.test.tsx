import { act, cleanup, fireEvent, render, within } from "../test/render";
import { activateAppLocale } from "../i18n/app";
import type { ItemArg } from "@tasknotes/calendar";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { TaskCalendarView } from "./task-calendar-view";
import type { CalendarEventData } from "./calendar-items";
import { defaultCalendarPreferences } from "./calendar-preferences";

import { parseDay } from "@tasknotes/calendar";
import type { TaskCalendarItem } from "./calendar-items";
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

afterEach(async () => {
  cleanup();
  calendar.props = undefined;
  vi.unstubAllGlobals();
  await act(() => activateAppLocale("en"));
});

describe("calendar drops", () => {
  it("shows a phone month's selected-day agenda immediately without a dismiss action", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const view = renderCalendar(execution("2026-07-01"), vi.fn());
    const inspector = within(view.container).getByRole("complementary", {
      name: "Selected day",
    });
    expect(inspector).toBeVisible();
    expect(inspector.querySelectorAll(".task-row")).toHaveLength(1);
    expect(
      within(inspector).queryByRole("button", { name: "Close day details" }),
    ).toBeNull();
    expect(calendar.props).toMatchObject({ monthDisplay: "dots" });
  });
  it("bounds calendar previews and keeps event targets compact", () => {
    renderCalendar(execution("2026-07-24"), vi.fn());
    expect(calendar.props).toMatchObject({
      eventMinHeight: 44,
      dayMaxEvents: 2,
      dayMaxEventRows: 3,
    });
  });

  it("reserves one all-day preview plus disclosure in timed layouts", () => {
    const original = execution("2026-07-24");
    original.view.presentation!.options.calendarView = "timeGridWeek";
    renderCalendar(original, vi.fn());
    expect(calendar.props).toMatchObject({
      eventMinHeight: 44,
      slotHeight: 36,
      dayMaxEventRows: 2,
    });
  });

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

  it("asks before a move clears completed occurrences, and keeps them on cancel", async () => {
    const recurring = execution("2026-07-24");
    const row = recurring.rows[0]!;
    row.task = new TaskNotesTaskModel().read({
      path: row.task.path,
      body: "",
      frontmatter: {
        ...row.task.frontmatter,
        recurrence: "DTSTART:20260724;FREQ=DAILY",
        complete_instances: ["2026-07-25"],
      },
    });
    const onUpdate = vi.fn(() => Promise.resolve());
    const view = renderCalendar(recurring, onUpdate);
    const item = items().find(
      (candidate) =>
        candidate.start === "2026-07-24" &&
        candidate.data?.metadata?.entry.task.id === "one",
    )!;
    const revert = vi.fn();
    change(
      "onItemDrop",
      item,
      {
        start: new Date(2026, 6, 22),
        end: new Date(2026, 6, 23),
        startStr: "2026-07-22",
        endStr: "2026-07-22",
        allDay: true,
      },
      revert,
    );
    const dialog = await vi.waitFor(() => {
      const found = view.container.ownerDocument.querySelector(
        '[role="alertdialog"]',
      );
      expect(found).not.toBeNull();
      return found!;
    });
    expect(dialog.textContent).toMatch(/completed or skipped occurrences/);
    await act(async () =>
      (
        [...dialog.querySelectorAll("button")].find(
          (button) => button.textContent === "Cancel",
        ) as HTMLButtonElement
      ).click(),
    );
    expect(revert).toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
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

describe("year layout", () => {
  it("opens a saved year view, and a day there opens its month when the day list is below", () => {
    const year = execution("2026-07-24");
    year.view.presentation!.options.calendarView = "multiMonthYear";
    const onSelect = vi.fn();
    render(
      <TaskCalendarView
        execution={year}
        identityTasks={year.rows.map((row) => row.task)}
        preferences={defaultCalendarPreferences("en-US")}
        selected="2026-07-01"
        selectedCreateValue="2026-07-01"
        titleProperty="title"
        onCreate={vi.fn()}
        onOpen={vi.fn()}
        onSelect={onSelect}
        onToggle={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(calendar.props!.view).toBe("year");
    act(() =>
      (calendar.props!.onDateClick as (info: unknown) => void)({
        dateStr: "2026-03-12",
        startStr: "2026-03-12",
        allDay: true,
        jsEvent: new MouseEvent("click"),
      }),
    );
    expect(onSelect).toHaveBeenCalledWith("2026-03-12", "2026-03-12");
    expect(calendar.props!.view).toBe("month");
  });
});

describe("shared agenda", () => {
  it.each(["dayGridMonth", "timeGridWeek", "listWeek"])(
    "keeps other-day plans on their deadline in %s and in day inspection",
    (mode) => {
      const current = execution("2026-07-02");
      current.rows[0].task.due = "2026-07-01";
      current.rows[0].values.due = "2026-07-01";
      current.view.presentation!.options.calendarView = mode;
      const view = renderCalendar(current, vi.fn());
      const due = items().find((item) => item.id === "due-one");
      expect(due?.start).toBe("2026-07-01");
      if (mode === "listWeek") return;
      act(() =>
        (calendar.props!.onDateClick as (info: unknown) => void)({
          dateStr: "2026-07-01",
          startStr: "2026-07-01",
          allDay: true,
          jsEvent: new MouseEvent("click"),
        }),
      );
      const inspector = within(view.container).getByRole("complementary", {
        name: "Selected day",
      });
      expect(within(inspector).getByText("1 task")).toBeVisible();
      expect(inspector.querySelectorAll(".task-row")).toHaveLength(1);
      expect(
        within(inspector).getByRole("button", {
          name: current.rows[0].task.title,
        }),
      ).toBeVisible();
      expect(
        inspector.querySelector(".task-row-inline-metadata"),
      ).toHaveTextContent("Due");
    },
  );

  it("opens grid day details only after a selection and offers an explicit close", () => {
    const view = within(
      renderCalendar(execution("2026-07-24"), vi.fn()).container,
    );
    expect(
      view.queryByRole("complementary", { name: "Selected day" }),
    ).toBeNull();
    act(() =>
      (calendar.props!.onDateClick as (info: unknown) => void)({
        dateStr: "2026-07-24",
        startStr: "2026-07-24",
        allDay: true,
        jsEvent: new MouseEvent("click"),
      }),
    );
    expect(
      view.getByRole("complementary", { name: "Selected day" }),
    ).toBeVisible();
    fireEvent.click(view.getByRole("button", { name: "Close day details" }));
    expect(
      view.queryByRole("complementary", { name: "Selected day" }),
    ).toBeNull();
  });

  it("starts a newly chosen time grid at the working day, not the agenda scroll offset", () => {
    const current = execution("2026-07-24");
    current.view.presentation!.options.calendarView = "dayGridMonth";
    const view = within(renderCalendar(current, vi.fn()).container);
    const scrollToTime = vi.fn();
    (calendar.props!.calendarRef as (instance: unknown) => void)({
      scrollToTime,
    });
    fireEvent.click(view.getByLabelText("Calendar layout"));
    fireEvent.click(view.getByRole("button", { name: "Week" }));
    expect(scrollToTime).toHaveBeenCalledWith("08:00:00");
    expect(calendar.props!.scrollTime).toBe("08:00:00");
  });
  it("uses the agenda, overdue lead and date-aware capture on desktop without changing Base options", () => {
    const current = execution("2026-07-24");
    current.view.presentation!.options = {
      calendarView: "listWeek",
      listDayCount: 11,
    };
    const onCreate = vi.fn();
    const onSelect = vi.fn();
    const preferences = { ...defaultCalendarPreferences("en-US"), firstDay: 1 };
    render(
      <TaskCalendarView
        execution={current}
        identityTasks={current.rows.map((row) => row.task)}
        preferences={preferences}
        selected="2026-07-24"
        selectedCreateValue="2026-07-24"
        titleProperty="title"
        onCreate={onCreate}
        onSelect={onSelect}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(calendar.props).toMatchObject({
      view: "list",
      listAgenda: true,
      dateStrip: true,
      listLeadTitle: "Overdue",
      listAddText: "Add task",
      firstDay: 1,
      listDayCount: 11,
    });
    act(() =>
      (calendar.props!.onListAdd as (arg: unknown) => void)({
        dateStr: "2026-07-29",
      }),
    );
    expect(onSelect).toHaveBeenCalledWith("2026-07-29");
    expect(onCreate).toHaveBeenCalledWith("2026-07-29");
    expect(current.view.presentation!.options).toEqual({
      calendarView: "listWeek",
      listDayCount: 11,
    });
  });

  it("mounts ordinary task controls without a surrounding calendar button", async () => {
    const current = execution("2026-07-24T09:30");
    current.view.presentation!.options.calendarView = "listWeek";
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const view = render(
      <TaskCalendarView
        execution={current}
        identityTasks={current.rows.map((row) => row.task)}
        preferences={defaultCalendarPreferences("en-US")}
        selected="2026-07-24"
        selectedCreateValue="2026-07-24"
        titleProperty="title"
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        onOpen={onOpen}
        onToggle={onToggle}
        onEdit={vi.fn()}
      />,
    );
    const item = items().find((item) => item.id === "scheduled-one")!;
    const el = document.createElement("div");
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    const arg = {
      item,
      el,
      variant: "list",
      isMirror: false,
      day: parseDay("2026-07-24"),
      timeText: "9:30am",
    };
    el.append((calendar.props!.listItemContent as (arg: unknown) => Node)(arg));
    view.container.append(el);
    act(() => (calendar.props!.itemDidMount as (arg: unknown) => void)(arg));
    expect(el).not.toHaveAttribute("role");
    expect(el).not.toHaveAttribute("tabindex");
    expect(el.querySelector(".task-row")).toBeTruthy();
    expect(el).toHaveTextContent("9:30am");
    fireEvent.click(view.getByRole("button", { name: "Calendar task" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await act(async () =>
      fireEvent.click(
        view.getByRole("button", { name: "Complete Calendar task" }),
      ),
    );
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
    act(() => (calendar.props!.itemWillUnmount as (arg: unknown) => void)(arg));
    expect(el.querySelector(".task-row")).toBeNull();
  });
});

describe("calendar entry labels", () => {
  it("names a timed entry's local day east of UTC", () => {
    renderCalendar(execution("2026-07-24T22:00:00Z"), vi.fn());
    const item = items().find((entry) => !entry.allDay)!;
    const el = document.createElement("div");
    vi.stubEnv("TZ", "Australia/Melbourne");
    try {
      (calendar.props!.itemDidMount as (arg: unknown) => void)({
        item,
        el,
        variant: "timed",
      });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(el.dataset.date).toBe("2026-07-25");
    expect(el.getAttribute("aria-label")).toContain("Saturday, July 25");
  });

  it("puts the title before the time in grid cards", () => {
    renderCalendar(execution("2026-07-24T09:30"), vi.fn());
    const item = items().find((entry) => !entry.allDay)!;
    const el = document.createElement("div");
    const fragment = (calendar.props!.itemContent as (arg: unknown) => Node)({
      item,
      el,
      variant: "timed",
      timeText: "9:30am – 10:30am",
    });
    el.append(fragment);
    expect(el.textContent).toMatch(/^Calendar task9:30am/);
  });
  it("keeps month entry times and titles together for two-line wrapping", () => {
    renderCalendar(execution("2026-07-24T09:30"), vi.fn());
    const item = items().find((entry) => !entry.allDay)!;
    const el = document.createElement("div");
    el.append(
      (calendar.props!.itemContent as (arg: unknown) => Node)({
        item,
        el,
        variant: "bar",
        timeText: "9:30am",
      }),
    );
    expect(el.querySelector(".full-calendar-event-primary")).toHaveTextContent(
      "9:30am · Calendar task",
    );
    expect(el.querySelector(".full-calendar-event-secondary")).toBeNull();
  });
  it("provides the full event identity for hover and focused inspection", () => {
    renderCalendar(execution("2026-07-24T09:30"), vi.fn());
    const item = items().find((entry) => !entry.allDay)!;
    const el = document.createElement("div");
    (calendar.props!.itemDidMount as (arg: unknown) => void)({
      item,
      el,
      variant: "timed",
    });
    expect(el.title).toContain(item.title);
    expect(el.title).toBe(el.getAttribute("aria-label"));
  });
  it("names an all-day entry's own day west of UTC", () => {
    renderCalendar(execution("2026-07-24"), vi.fn());
    const item = items().find((entry) => entry.allDay)!;
    const el = document.createElement("div");
    vi.stubEnv("TZ", "America/New_York");
    try {
      (calendar.props!.itemDidMount as (arg: unknown) => void)({
        item,
        el,
        variant: "dayGrid",
      });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(el.getAttribute("aria-label")).toContain("Friday, July 24");
  });
});

describe("localized calendar entry kinds", () => {
  it("refreshes the external calendar title when only the language changes", async () => {
    const view = renderCalendar(execution("2026-07-24"), vi.fn());
    // The visible range has not changed, so there is no range notification.
    (calendar.props!.calendarRef as (instance: unknown) => void)({
      getView: () => ({ title: "luglio 2026" }),
    });
    await act(() => activateAppLocale("it"));
    expect(
      view.container.querySelector(".full-calendar-commandbar > h2"),
    ).toHaveTextContent("luglio 2026");
  });

  it.each([
    ["en", "Due"],
    ["de", "Fällig"],
    ["it", "Scadenza"],
  ] as const)(
    "deduplicates due markers before rendering %s labels",
    async (locale, label) => {
      const current = execution("2026-07-24");
      current.rows[0]!.task.due = "2026-07-25";
      current.rows[0]!.values.due = "2026-07-25";
      current.view.properties = [{ key: "due" }];
      renderCalendar(current, vi.fn());
      // Changing language keeps the calendar mounted and refreshes DOM hooks.
      await act(() => activateAppLocale(locale));
      expect(calendar.props!.locale).toBe(locale);
      const due = items().find((item) => item.id === "due-one")!;
      expect(due).toBeDefined();
      const content = (variant: "list" | "timed") => {
        const el = document.createElement("div");
        const arg: ItemArg<CalendarEventData> = {
          item: due,
          el,
          variant,
          timeText: "",
          day: parseDay("2026-07-25")!,
          view: {
            type: variant === "list" ? "list" : "week",
            range: {
              start: new Date(2026, 6, 24),
              end: new Date(2026, 6, 31),
              startDay: parseDay("2026-07-24")!,
              endDay: parseDay("2026-07-31")!,
            },
            anchor: parseDay("2026-07-24")!,
            title: "",
            dataRange: {
              start: new Date(2026, 6, 24),
              end: new Date(2026, 6, 31),
              startDay: parseDay("2026-07-24")!,
              endDay: parseDay("2026-07-31")!,
            },
          },
          isStart: true,
          isEnd: true,
          isMirror: false,
        };
        el.append(
          (
            calendar.props!.itemContent as (
              info: ItemArg<CalendarEventData>,
            ) => Node
          )(arg),
        );
        return el;
      };
      expect(
        content("list").querySelector(".full-calendar-event-kind"),
      ).toBeNull();
      expect(
        content("timed").querySelector(".full-calendar-event-kind"),
      ).toHaveTextContent(label);
      expect(
        content("list").querySelector(".full-calendar-event-properties"),
      ).toHaveTextContent(label);
    },
  );
});

function items(): TaskCalendarItem[] {
  return (calendar.props?.items ?? []) as TaskCalendarItem[];
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
  item: TaskCalendarItem,
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

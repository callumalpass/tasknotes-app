import { act, cleanup, fireEvent, render, within } from "../test/render";
import { activateAppLocale } from "../i18n/app";
import type { ItemArg } from "@tasknotes/calendar";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { TaskCalendarView } from "./task-calendar-view";
import type { CalendarEventData } from "./calendar-items";
import {
  defaultCalendarPreferences,
  type CalendarPreferences,
} from "./calendar-preferences";
import type { useGoogleCalendarOverlay } from "../calendar-service/use-google-calendar-overlay";

import { parseDay } from "@tasknotes/calendar";
import type { TaskCalendarItem } from "./calendar-items";
import type { Task, TaskSummary } from "../domain/task";
import type { TaskViewExecution } from "../domain/view";

// The calendar does not lay out in jsdom; the test drives the props the view
// hands it, which is where a dropped item's dates come from.
const calendar = vi.hoisted(() => ({
  props: undefined as undefined | Record<string, unknown>,
  google: undefined as ReturnType<typeof useGoogleCalendarOverlay> | undefined,
}));
vi.mock("../calendar-service/use-google-calendar-overlay", async (original) => {
  const actual =
    await original<
      typeof import("../calendar-service/use-google-calendar-overlay")
    >();
  return {
    useGoogleCalendarOverlay: (
      ...args: Parameters<typeof useGoogleCalendarOverlay>
    ) => calendar.google ?? actual.useGoogleCalendarOverlay(...args),
  };
});
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
  calendar.google = undefined;
  vi.unstubAllGlobals();
  await act(() => activateAppLocale("en"));
});

it("keeps the time-grid overlap layout uncapped and non-obscuring", () => {
  const model = new TaskNotesTaskModel();
  const execution = {
    view: {
      key: "calendar",
      properties: [],
      presentation: {
        type: "tasknotes.calendar",
        options: { calendarView: "timeGridWeek" },
      },
    },
    rows: [],
    groups: [],
    totalCount: 0,
    hasMore: false,
  } as unknown as TaskViewExecution;
  render(
    <TaskCalendarView
      execution={execution}
      preferences={defaultCalendarPreferences("en-US")}
      identityTasks={[]}
      selected="2026-11-07"
      selectedCreateValue="2026-11-07"
      titleProperty={model.configuration().fieldMapping.title}
      onSelect={vi.fn()}
      onCreate={vi.fn()}
      onOpen={vi.fn()}
      onToggle={vi.fn()}
      onEdit={vi.fn()}
    />,
  );
  expect(calendar.props).toMatchObject({
    eventMaxStack: 0,
    slotEventOverlap: false,
  });
});

describe("time slot height", () => {
  function renderWith(
    options: Record<string, unknown>,
    preferences: Partial<CalendarPreferences> = {},
  ) {
    const onSlotHeightChange = vi.fn();
    const execution = {
      view: {
        key: "calendar",
        properties: [],
        presentation: {
          type: "tasknotes.calendar",
          options: { calendarView: "timeGridWeek", ...options },
        },
      },
      rows: [],
      groups: [],
      totalCount: 0,
      hasMore: false,
    } as unknown as TaskViewExecution;
    render(
      <TaskCalendarView
        execution={execution}
        preferences={{ ...defaultCalendarPreferences("en-US"), ...preferences }}
        onSlotHeightChange={onSlotHeightChange}
        identityTasks={[]}
        selected="2026-11-07"
        selectedCreateValue="2026-11-07"
        titleProperty={
          new TaskNotesTaskModel().configuration().fieldMapping.title
        }
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    return onSlotHeightChange;
  }

  it("uses the app default, then the view's height, then the device's", () => {
    renderWith({});
    expect(calendar.props).toMatchObject({ slotHeight: 36, pinchZoom: true });
    cleanup();
    renderWith({ slotHeight: 20 });
    expect(calendar.props?.slotHeight).toBe(20);
    cleanup();
    renderWith({ slotHeight: 20 }, { slotHeight: 64 });
    expect(calendar.props?.slotHeight).toBe(64);
  });

  it("lets the view or the device turn pinching off", () => {
    renderWith({ pinchZoom: false });
    expect(calendar.props?.pinchZoom).toBe(false);
    cleanup();
    renderWith({}, { pinchZoom: false });
    expect(calendar.props?.pinchZoom).toBe(false);
  });

  it("reports pinched heights for the device", () => {
    const onSlotHeightChange = renderWith({});
    (calendar.props?.onSlotHeightChange as (height: number) => void)(52);
    expect(onSlotHeightChange).toHaveBeenCalledWith(52);
  });
});

describe("Google events alongside task calendars", () => {
  function overlay() {
    const googleCalendar = {
      id: "calendar-one",
      name: "Work",
      can_write: true,
      is_primary: true,
    };
    const event = {
      status: "confirmed" as const,
      id: "google-one",
      calendar_id: googleCalendar.id,
      etag: '"1"',
      title: "Planning",
      description: null,
      location: null,
      recurrence: null,
      start: { kind: "date" as const, date: "2026-06-30" },
      end: { kind: "date" as const, date: "2026-07-02" },
    };
    const item: TaskCalendarItem = {
      id: "google:google-one",
      title: event.title,
      start: event.start.date,
      end: event.end.date,
      allDay: true,
      color: "var(--google-calendar-tone-0)",
      editable: true,
      data: {
        details: [],
        recurring: false,
        google: { event, calendar: googleCalendar },
      },
    };
    calendar.google = {
      enabled: true,
      signedIn: true,
      items: [item],
      writable: [googleCalendar],
      events: [event],
      failure: null,
      omitted: 0,
      loading: false,
      reload: vi.fn(),
      replaceEvent: vi.fn(),
      move: vi.fn(),
      editor: null,
      closeEditor: vi.fn(),
      open: vi.fn(),
      create: vi.fn(),
    };
    return { item, google: calendar.google };
  }

  it.each(["dayGridMonth", "timeGridWeek", "listWeek"])(
    "renders and edits Google events in %s without treating them as tasks",
    (mode) => {
      const { item, google } = overlay();
      const current = execution("2026-07-01");
      current.view.presentation!.options.calendarView = mode;
      const update = vi.fn();
      renderCalendar(current, update);
      expect(items().some((candidate) => candidate.id === item.id)).toBe(true);
      const content = (
        calendar.props![
          mode === "listWeek" ? "listItemContent" : "itemContent"
        ] as (arg: unknown) => Node
      )({
        item,
        el: document.createElement("div"),
        variant: mode === "listWeek" ? "list" : "bar",
        timeText: "",
        isMirror: false,
        view: { type: mode === "listWeek" ? "list" : "month" },
      });
      // The agenda leaves a slot for the event's row; a grid writes its title.
      if (mode === "listWeek") expect(content).toHaveClass("agenda-event-slot");
      else expect(content.textContent).toContain("Planning");
      expect(
        (content as HTMLElement).querySelector(".agenda-task-slot"),
      ).toBeNull();
      (calendar.props!.onItemClick as (arg: unknown) => void)({ item });
      expect(google.open).toHaveBeenCalledWith(item.data!.google);
      for (const handler of ["onItemDrop", "onItemResize"]) {
        const change = { item, revert: vi.fn() };
        (calendar.props![handler] as (arg: unknown) => void)(change);
        expect(google.move).toHaveBeenCalledWith(change);
      }
      expect(update).not.toHaveBeenCalled();
    },
  );

  it("reads an agenda event as a row under each of its days", () => {
    const { item } = overlay();
    const current = execution("2026-07-01");
    current.view.presentation!.options.calendarView = "listWeek";
    renderCalendar(current, vi.fn());
    const el = document.createElement("div");
    el.setAttribute("role", "button");
    const arg = {
      item,
      el,
      day: parseDay("2026-07-01"),
      variant: "list",
      timeText: "",
      isMirror: false,
      view: { type: "list" },
    };
    el.append((calendar.props!.listItemContent as (arg: unknown) => Node)(arg));
    document.body.append(el);
    act(() => (calendar.props!.itemDidMount as (arg: unknown) => void)(arg));
    // The wrapper stays the one button that opens the event.
    expect(el).toHaveAccessibleName("Planning, All day · Day 2 of 2, Work");
    expect(el.querySelector(".google-event-row-title")).toHaveTextContent(
      "Planning",
    );
    expect(el.querySelector(".google-event-row-meta")).toHaveTextContent(
      "All day · Day 2 of 2Work",
    );
    el.remove();
  });

  it("says when a timed event of a day or more starts, where its bar begins", () => {
    const { item } = overlay();
    const event = {
      ...item.data!.google!.event,
      start: {
        kind: "date_time" as const,
        date_time: new Date(2026, 5, 30, 16).toISOString(),
      },
      end: {
        kind: "date_time" as const,
        date_time: new Date(2026, 6, 2, 10, 30).toISOString(),
      },
    };
    const long = {
      ...item,
      data: { ...item.data!, google: { ...item.data!.google!, event } },
    };
    renderCalendar(execution("2026-07-01"), vi.fn());
    const content = (isStart: boolean) =>
      (calendar.props!.itemContent as (arg: unknown) => Node)({
        item: long,
        el: document.createElement("div"),
        variant: "bar",
        timeText: "",
        isStart,
        isMirror: false,
        view: { type: "month" },
      }).textContent;
    expect(content(true)).toBe("4pm · Planning");
    expect(content(false)).toBe("Planning");
  });

  it("opens spanning Google events from a phone month's selected day", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const { item, google } = overlay();
    const finished = {
      ...item.data!.google!.event,
      id: "google-finished",
      title: "Finished yesterday",
      end: { kind: "date" as const, date: "2026-07-01" },
    };
    google.items.push({
      ...item,
      id: "google:finished",
      title: finished.title,
      start: "2026-06-30",
      end: "2026-07-01",
      data: {
        ...item.data!,
        google: { ...item.data!.google!, event: finished },
      },
    });
    const view = renderCalendar(execution("2026-07-01"), vi.fn());
    const inspector = within(view.container).getByRole("complementary", {
      name: "Selected day",
    });
    fireEvent.click(
      within(inspector).getByRole("button", {
        name: "Planning, All day · Day 2 of 2, Work",
      }),
    );
    expect(google.open).toHaveBeenCalledWith(item.data!.google);
    expect(within(inspector).queryByText("Finished yesterday")).toBeNull();
    expect(inspector.querySelectorAll(".task-row")).toHaveLength(1);
  });
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

  it("lets fine-pointer Month fit single-line bars to the available height", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("pointer: fine"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    renderCalendar(execution("2026-07-24"), vi.fn());
    expect(calendar.props).toMatchObject({
      dayMaxEvents: true,
      dayMaxEventRows: 0,
    });
    expect(calendar.props).toMatchObject({
      height: "fill",
      eventMinHeight: 26,
    });
    expect(calendar.props).toMatchObject({
      style: { height: expect.any(Number) },
    });
  });

  it("omits priority markers from the intensity-based Year layout", () => {
    const original = execution("2026-07-24");
    original.view.presentation!.options.calendarView = "multiMonthYear";
    original.rows[0]!.task.priority = "high";
    const view = renderCalendar(original, vi.fn());
    expect(view.container.querySelector(".full-calendar-legend")).toBeNull();
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

  it("exposes a bounded set of wrapping all-day cards in Day", () => {
    const original = execution("2026-07-24");
    original.view.presentation!.options.calendarView = "timeGridDay";
    renderCalendar(original, vi.fn());
    expect(calendar.props!.dayMaxEventRows).toBe(7);
    expect(document.querySelector(".full-calendar-view")).toHaveClass("is-day");
  });

  it("keeps Agenda's layout and navigation in the common toolbar", () => {
    const original = execution("2026-07-24");
    original.view.presentation!.options.calendarView = "listWeek";
    const view = renderCalendar(original, vi.fn());
    const toolbar = view.container.querySelector(".full-calendar-commandbar")!;
    expect(
      within(toolbar as HTMLElement).getByText("Agenda", {
        selector: "summary span",
      }),
    ).toBeVisible();
    const stripNext = document.createElement("button");
    stripNext.className = "tnc-strip-next";
    const navigate = vi.fn();
    stripNext.addEventListener("click", navigate);
    view.container.querySelector(".full-calendar-view")!.append(stripNext);
    fireEvent.click(
      within(toolbar as HTMLElement).getByRole("button", { name: "Next week" }),
    );
    expect(navigate).toHaveBeenCalledOnce();
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
  it.each(["timed", "bar"])(
    "provides one full-title tooltip on hover and focus for %s",
    (variant) => {
      renderCalendar(execution("2026-07-24T09:30"), vi.fn());
      const item = items().find((entry) => !entry.allDay)!;
      const el = document.createElement("div");
      el.className = `tnc-item tnc-item--${variant}`;
      el.setAttribute("role", "button");
      (calendar.props!.itemDidMount as (arg: unknown) => void)({
        item,
        el,
        variant,
      });
      expect(el).not.toHaveAttribute("title");
      document.querySelector(".full-calendar-view")!.append(el);
      fireEvent.pointerOver(el);
      expect(document.querySelector('[role="tooltip"]')).toHaveTextContent(
        item.title,
      );
      fireEvent.pointerOut(el);
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
      fireEvent.focus(el);
      expect(document.querySelector('[role="tooltip"]')).toHaveTextContent(
        item.title,
      );
    },
  );
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

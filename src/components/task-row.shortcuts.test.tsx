import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  requestTaskShortcut,
  shortcutSchedule,
  subscribeShortcutAnnouncements,
} from "../app/keyboard-shortcuts";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import type { Task } from "../domain/task";
import { TaskRow } from "./task-row";

const updateTask = vi.fn();
vi.mock("../app/repository-context", () => ({
  useRepository: () => ({
    configuration: defaultTaskCollectionConfiguration(),
    updateTask,
  }),
}));
vi.mock("./task-actions", () => ({ TaskActions: () => null }));
vi.mock("./task-property-editor", () => ({ TaskPropertyEditor: () => null }));

const announcements: string[] = [];
let unsubscribe = () => {};
beforeEach(() => {
  updateTask.mockReset().mockResolvedValue(undefined);
  announcements.length = 0;
  unsubscribe = subscribeShortcutAnnouncements((message) =>
    announcements.push(message),
  );
});
afterEach(() => {
  unsubscribe();
  cleanup();
  vi.restoreAllMocks();
});

const task = {
  id: "one",
  title: "Write brief",
  scheduled: "2026-08-13T09:30",
  status: "open",
  priority: "normal",
  timeEntries: [],
} as unknown as Task;

function renderRow(props: Partial<Parameters<typeof TaskRow>[0]> = {}) {
  const onOpen = vi.fn();
  const onToggle = vi.fn().mockResolvedValue(undefined);
  render(
    <TaskRow task={task} onOpen={onOpen} onToggle={onToggle} {...props} />,
  );
  const title = screen.getByRole("button", { name: task.title });
  title.focus();
  return { onOpen, onToggle, title };
}

it("exposes the task on the row for keyboard navigation", () => {
  const { title } = renderRow();
  const row = title.closest(".task-row")!;
  expect(row).toHaveAttribute("data-task-id", "one");
  expect(row).toHaveAttribute("data-task-title", "Write brief");
  expect(row).not.toHaveAttribute("data-task-completed");
});

it("opens on o and toggles on x with an announcement", async () => {
  const { onOpen, onToggle, title } = renderRow();
  fireEvent.keyDown(title, { key: "o" });
  expect(onOpen).toHaveBeenCalledWith(task, undefined);
  fireEvent.keyDown(title, { key: "x" });
  expect(onToggle).toHaveBeenCalledWith(task, undefined);
  await waitFor(() =>
    expect(announcements).toEqual(["Completed Write brief."]),
  );
});

it("schedules with t, m, and w through the task update path, keeping the time", async () => {
  const { title } = renderRow();
  fireEvent.keyDown(title, { key: "t" });
  await waitFor(() =>
    expect(updateTask).toHaveBeenLastCalledWith("one", {
      scheduled: shortcutSchedule("today", task.scheduled),
    }),
  );
  expect(updateTask.mock.lastCall![1].scheduled).toMatch(/T09:30$/);
  fireEvent.keyDown(title, { key: "m" });
  await waitFor(() =>
    expect(updateTask).toHaveBeenLastCalledWith("one", {
      scheduled: shortcutSchedule("tomorrow", task.scheduled),
    }),
  );
  fireEvent.keyDown(title, { key: "w" });
  await waitFor(() =>
    expect(updateTask).toHaveBeenLastCalledWith("one", {
      scheduled: shortcutSchedule("next-week", task.scheduled),
    }),
  );
  expect(announcements).toEqual([
    "Scheduled Write brief for today.",
    "Scheduled Write brief for tomorrow.",
    "Scheduled Write brief for next week.",
  ]);
});

it("ignores row keys with modifiers and unbound keys", () => {
  const { onToggle, title } = renderRow();
  fireEvent.keyDown(title, { key: "x", ctrlKey: true });
  fireEvent.keyDown(title, { key: "x", metaKey: true });
  fireEvent.keyDown(title, { key: "X", shiftKey: true });
  fireEvent.keyDown(title, { key: "Delete" });
  expect(onToggle).not.toHaveBeenCalled();
  expect(updateTask).not.toHaveBeenCalled();
});

it("shows the error and stays quiet when scheduling fails", async () => {
  updateTask.mockRejectedValue(new Error("Offline: try again"));
  const { title } = renderRow();
  fireEvent.keyDown(title, { key: "t" });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Offline: try again",
  );
  expect(announcements).toEqual([]);
});

it.each(["m", "x"])(
  "restores focus when %s removes the row after the action frame",
  async (key) => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const other = { ...task, id: "two", title: "Book room" } as Task;
    const view = (showFirst: boolean) => (
      <main id="main-content">
        {showFirst ? (
          <TaskRow
            key="one"
            task={task}
            onOpen={vi.fn()}
            onToggle={vi.fn().mockResolvedValue(undefined)}
          />
        ) : null}
        <TaskRow key="two" task={other} onOpen={vi.fn()} onToggle={vi.fn()} />
      </main>
    );
    const { rerender } = render(view(true));
    const title = screen.getByRole("button", { name: task.title });
    title.focus();
    fireEvent.keyDown(title, { key });
    await waitFor(() => expect(announcements).toHaveLength(1));
    act(() => frames.splice(0).forEach((frame) => frame(0)));
    expect(title).toHaveFocus();

    // Query refresh lands later than the mutation promise/first focus attempt.
    rerender(view(false));
    act(() => frames.splice(0).forEach((frame) => frame(0)));
    expect(screen.getByRole("button", { name: "Book room" })).toHaveFocus();
  },
);

it("runs actions the command palette requests", async () => {
  const { onToggle, title } = renderRow();
  requestTaskShortcut(title.closest(".task-row")!, "toggle");
  expect(onToggle).toHaveBeenCalledOnce();
  await waitFor(() => expect(announcements).toHaveLength(1));
});

it("leaves the dates of a virtual recurring occurrence alone", async () => {
  const { title } = renderRow({
    task: { ...task, recurrence: "FREQ=DAILY" } as Task,
    occurrence: {
      task: { ...task, recurrence: "FREQ=DAILY" },
      date: "2026-08-13",
      completed: false,
    } as never,
  });
  fireEvent.keyDown(title, { key: "m" });
  await waitFor(() => expect(announcements).toHaveLength(1));
  expect(announcements[0]).toMatch(/repeating task/);
  expect(updateTask).not.toHaveBeenCalled();
});

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../test/render";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { TaskSelectionStore } from "./task-selection-store";
import { BulkTaskActions } from "./bulk-task-actions";
import type { Task, UpdateTaskInput } from "../domain/task";

const recovery = vi.hoisted(() => ({
  pendingDeletion: null as { id: string; ids: string[]; bulk: boolean } | null,
  deletionError: null as Error | null,
}));
const fixture = vi.hoisted(() => ({
  getSummary: vi.fn(),
  completeField: vi.fn(async () => []),
  updateTask: vi.fn(),
  setTaskArchived: vi.fn(),
  deleteTask: vi.fn(),
}));
const configuration = defaultTaskCollectionConfiguration();
vi.mock("./repository-context", () => ({
  useRepository: () => ({
    repository: fixture,
    configuration,
    ...fixture,
    ...recovery,
  }),
}));
beforeEach(() => {
  recovery.pendingDeletion = null;
  recovery.deletionError = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  fixture.updateTask.mockReset();
  fixture.getSummary.mockReset();
  fixture.deleteTask.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const setup = () => {
  const store = new TaskSelectionStore(),
    model = new TaskNotesTaskModel();
  const tasks = ["a", "b"].map((id) =>
    model.create({ title: `Task ${id}` }, { id }),
  );
  fixture.getSummary.mockImplementation(async (id) =>
    tasks.find((task) => task.id === id),
  );
  fixture.updateTask.mockImplementation(
    async (id: string, input: UpdateTaskInput) => {
      if (id === "b") throw new Error("conflict: changed elsewhere");
      return { ...tasks[0], ...input, revision: tasks[0].revision + 1 } as Task;
    },
  );
  store.register({}, tasks);
  store.all();
  return { store, tasks };
};
it.each([true, false])(
  "asks before scheduling missed deadlines and respects keep=%s",
  async (keepDeadlines) => {
    const { store, tasks } = setup();
    tasks[0].due = "2000-01-01T17:00";
    render(<BulkTaskActions store={store} navigationKey="today" />);
    fireEvent.click(
      screen.getByRole("combobox", { name: "Schedule selected tasks" }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "Tomorrow" }));
    expect(fixture.updateTask).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: keepDeadlines ? "Keep due dates" : "Move due dates too",
      }),
    );
    await waitFor(() => expect(fixture.updateTask).toHaveBeenCalled());
    const input = fixture.updateTask.mock.calls[0][1];
    if (keepDeadlines) expect(input).not.toHaveProperty("due");
    else expect(input.due).toMatch(/T17:00/);
  },
);
it("announces only accepted rows, names failures and keeps them selected", async () => {
  const { store } = setup();
  render(<BulkTaskActions store={store} navigationKey="today" />);
  fireEvent.click(
    screen.getByRole("combobox", { name: "Priority for selected tasks" }),
  );
  fireEvent.click(await screen.findByRole("option", { name: "Low" }));
  await waitFor(() => expect(store.busy).toBe(false));
  expect(screen.getByText("Set priority to Low for 1 task")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "1 task could not be updated",
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Task b: conflict: changed elsewhere",
  );
  expect(store.selectedTasks.map((task) => task.id)).toEqual(["b"]);
  expect(fixture.updateTask).toHaveBeenCalledTimes(2);
});
it("never offers a success notice when all writes fail", async () => {
  const { store } = setup();
  fixture.updateTask.mockRejectedValue(new Error("outcome unknown"));
  render(<BulkTaskActions store={store} navigationKey="today" />);
  fireEvent.click(screen.getByRole("button", { name: /^Complete$/ }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "2 tasks could not be updated",
    ),
  );
  expect(screen.queryByText(/tasks? updated/)).not.toBeInTheDocument();
  expect(store.count).toBe(2);
});
it("excludes series and materialized occurrences without making any write", async () => {
  const { tasks } = setup();
  const only = new TaskSelectionStore();
  only.register({}, [
    { ...tasks[0], recurrence: "FREQ=DAILY" },
    {
      ...tasks[1],
      recurrenceParent: "[[Series]]",
      occurrenceDate: "2026-11-04",
    },
  ]);
  only.all();
  render(<BulkTaskActions store={only} navigationKey="today" />);
  expect(screen.getByText(/2 repeating tasks won’t change/)).toBeVisible();
  expect(screen.getByRole("button", { name: /^Complete$/ })).toBeDisabled();
  expect(fixture.updateTask).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Move selected tasks to project" }),
    ).toBeDisabled(),
  );
});
it("requests deletion as one group through the existing path", async () => {
  const { store } = setup();
  fixture.deleteTask.mockResolvedValue(undefined);
  render(<BulkTaskActions store={store} navigationKey="today" />);
  fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
  await waitFor(() =>
    expect(fixture.deleteTask).toHaveBeenCalledWith(["a", "b"]),
  );
  await waitFor(() => expect(store.count).toBe(0));
});

it("returns failed delayed deletions to selection and blocks edits until recovery", async () => {
  const { store } = setup();
  fixture.deleteTask.mockResolvedValue(undefined);
  const view = render(<BulkTaskActions store={store} navigationKey="today" />);
  fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
  await waitFor(() => expect(store.count).toBe(0));
  recovery.pendingDeletion = { id: "a", ids: ["a", "b"], bulk: true };
  recovery.deletionError = new Error("conflict: changed elsewhere");
  await act(async () => {
    view.rerender(<BulkTaskActions store={store} navigationKey="today" />);
  });
  await waitFor(() => expect(store.count).toBe(2));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Task a: conflict: changed elsewhere",
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Task b: Deletion stopped before this task was changed.",
  );
  expect(screen.getByRole("button", { name: /^Complete$/ })).toBeDisabled();
  expect(fixture.updateTask).not.toHaveBeenCalled();
  recovery.pendingDeletion = null;
  recovery.deletionError = null;
  view.rerender(<BulkTaskActions store={store} navigationKey="today" />);
  expect(screen.getByRole("button", { name: /^Complete$/ })).toBeEnabled();
});

it("clears the Undo receipt on navigation, including when returning to the same list", async () => {
  const { store, tasks } = setup();
  fixture.updateTask.mockImplementation(
    async (id: string, input: UpdateTaskInput) =>
      ({
        ...tasks.find((task) => task.id === id),
        ...input,
        revision: 2,
      }) as Task,
  );
  const view = render(<BulkTaskActions store={store} navigationKey="today" />);
  fireEvent.click(screen.getByRole("button", { name: /^Complete$/ }));
  await waitFor(() =>
    expect(screen.getByText("Completed 2 tasks")).toBeVisible(),
  );
  view.rerender(<BulkTaskActions store={store} navigationKey="search" />);
  view.rerender(<BulkTaskActions store={store} navigationKey="today" />);
  expect(screen.queryByText("Completed 2 tasks")).not.toBeInTheDocument();
});

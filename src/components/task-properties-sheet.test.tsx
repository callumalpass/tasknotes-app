import { fireEvent, render, screen, waitFor } from "../test/render";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { TaskPropertiesSheet } from "./task-properties-sheet";
import type { TaskSummary } from "../domain/task";

const state = vi.hoisted(() => ({ updateTask: vi.fn(), getSummary: vi.fn() }));
vi.mock("../app/repository-context", () => ({
  useRepository: () => ({
    configuration: {
      ...defaultTaskCollectionConfiguration(),
      userFields: [
        { id: "energy", key: "energy", displayName: "Energy", type: "number" },
        { id: "effort", key: "effort", displayName: "Effort", type: "number" },
      ],
    },
    repository: {
      getSummary: state.getSummary,
      completeField: vi.fn(async () => []),
    },
    updateTask: state.updateTask,
  }),
}));

it("edits priority and a configured custom field from one named property sheet", async () => {
  const task = {
    id: "one",
    title: "Write brief",
    status: "open",
    priority: "normal",
    projects: [],
    customProperties: { energy: 3, other: "keep" },
  } as unknown as TaskSummary;
  state.getSummary.mockResolvedValue(task);
  state.updateTask.mockImplementation(async (_id: string, input: object) => ({
    ...task,
    ...input,
  }));
  render(<TaskPropertiesSheet task={task} onClose={vi.fn()} />);
  expect(screen.getByRole("dialog", { name: "Task properties" })).toBeVisible();
  fireEvent.click(screen.getByRole("combobox", { name: "Priority" }));
  fireEvent.click(screen.getByRole("option", { name: /High/ }));
  await waitFor(() =>
    expect(state.updateTask).toHaveBeenCalledWith("one", { priority: "high" }),
  );
  const custom = screen.getByRole("spinbutton", { name: "Energy" });
  fireEvent.change(custom, { target: { value: "5" } });
  fireEvent.blur(custom);
  await waitFor(() =>
    expect(state.updateTask).toHaveBeenCalledWith("one", {
      customProperties: { energy: 5, other: "keep" },
    }),
  );
  expect(screen.getByRole("button", { name: "Scheduled date" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Due date" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Projects" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Tags" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Contexts" })).toBeVisible();
});

it("serializes custom-field saves against the latest task without dropping either edit", async () => {
  let latest = {
    id: "two",
    title: "Write brief",
    status: "open",
    priority: "normal",
    projects: [],
    customProperties: { energy: 3, effort: 2, other: "keep" },
  } as unknown as TaskSummary;
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.updateTask.mockReset();
  state.getSummary.mockImplementation(async () => latest);
  state.updateTask.mockImplementation(async (_id: string, input: object) => {
    await blocked;
    latest = { ...latest, ...input };
    return latest;
  });
  render(<TaskPropertiesSheet task={latest} onClose={vi.fn()} />);
  for (const name of ["Energy", "Effort"]) {
    const input = screen.getByRole("spinbutton", { name });
    fireEvent.change(input, {
      target: { value: name === "Energy" ? "5" : "8" },
    });
    fireEvent.blur(input);
  }
  await waitFor(() => expect(state.updateTask).toHaveBeenCalledTimes(1));
  release();
  await waitFor(() => expect(state.updateTask).toHaveBeenCalledTimes(2));
  expect(state.updateTask).toHaveBeenLastCalledWith("two", {
    customProperties: { energy: 5, effort: 8, other: "keep" },
  });
});

it("refreshes persisted values after Undo without resetting unrelated field drafts", () => {
  const task = {
    id: "three",
    title: "Write brief",
    revision: 1,
    status: "open",
    priority: "normal",
    recurrence: "FREQ=DAILY",
    projects: [],
    customProperties: { energy: 3 },
  } as unknown as TaskSummary;
  const onClose = vi.fn();
  const { rerender } = render(
    <TaskPropertiesSheet task={task} onClose={onClose} />,
  );
  expect(screen.getByRole("combobox", { name: "Repeat" })).toHaveAttribute(
    "data-value",
    "daily",
  );
  const custom = screen.getByRole("spinbutton", { name: "Energy" });
  fireEvent.change(custom, { target: { value: "5" } });
  rerender(
    <TaskPropertiesSheet
      task={{ ...task, revision: 2, recurrence: "FREQ=WEEKLY;BYDAY=MO,WE,FR" }}
      onClose={onClose}
    />,
  );
  expect(screen.getByRole("combobox", { name: "Repeat" })).toHaveAttribute(
    "data-value",
    "weekly",
  );
  expect(custom).toHaveValue(5);
});

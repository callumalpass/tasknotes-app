import { render, screen, cleanup, fireEvent } from "../test/render";
import { afterEach, expect, it, vi } from "vitest";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import type { Task } from "../domain/task";
import type { TaskRowRelation } from "../domain/task-row-relations";
import { TaskRow } from "./task-row";

const relations = vi.hoisted(() => ({
  current: {} as Record<string, TaskRowRelation>,
}));
vi.mock("../app/repository-context", () => ({
  useRepository: () => ({
    configuration: defaultTaskCollectionConfiguration(),
  }),
}));
vi.mock("../app/use-task-row-relation", () => ({
  useTaskRowRelation: (id: string) => relations.current[id],
}));
vi.mock("./task-row-subtasks", () => ({
  TaskRowSubtasks: ({ id, task }: { id: string; task: Task }) => (
    <div id={id} data-testid="subtasks">
      Subtasks of {task.title}
    </div>
  ),
}));
vi.mock("./task-actions", () => ({
  TaskActions: () => (
    <button type="button" className="task-actions-trigger">
      Actions
    </button>
  ),
}));
vi.mock("./task-property-editor", () => ({
  TaskPropertyEditor: () => <div role="dialog">Edit property</div>,
}));
afterEach(() => {
  cleanup();
  relations.current = {};
});

const task = {
  id: "one",
  title: "Write brief",
  status: "open",
  priority: "normal",
  timeEntries: [],
} as unknown as Task;

function row(patch: Partial<Task> = {}) {
  return render(
    <TaskRow
      task={{ ...task, ...patch }}
      details={[]}
      onOpen={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
}

it("shows nothing extra for a task with no subtasks or open blockers", () => {
  const { container } = row();
  expect(container.querySelector(".task-row-blocked")).toBeNull();
  expect(container.querySelector(".task-row-subtask-toggle")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Write brief" }),
  ).not.toHaveAttribute("aria-description");
});

it("counts subtasks and opens them beneath the row", () => {
  relations.current = { one: { subtasks: 3, subtasksDone: 1, blockedBy: 0 } };
  const { container } = row();
  const toggle = screen.getByRole("button", { name: "Subtasks: 1 of 3" });
  expect(toggle).toHaveTextContent("1/3");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  // The phone row carries the same count as plain text inside the title.
  expect(
    container.querySelector(".task-row-compact-metadata"),
  ).toHaveTextContent("1/3");
  expect(screen.getByRole("button", { name: "Write brief" })).toHaveAttribute(
    "aria-description",
    "Subtasks: 1 of 3",
  );
  expect(screen.queryByTestId("subtasks")).toBeNull();

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByTestId("subtasks")).toHaveAttribute(
    "id",
    toggle.getAttribute("aria-controls"),
  );

  fireEvent.click(toggle);
  expect(screen.queryByTestId("subtasks")).toBeNull();
});

it("marks a task that is waiting on others, in words", () => {
  relations.current = { one: { subtasks: 0, subtasksDone: 0, blockedBy: 2 } };
  const { container } = row();
  const markers = container.querySelectorAll(".task-row-blocked");
  // One for the phone row and one for the desktop row; CSS shows either.
  expect(markers).toHaveLength(2);
  for (const marker of markers) expect(marker).toHaveTextContent("Blocked");
  expect(screen.getByRole("button", { name: "Write brief" })).toHaveAttribute(
    "aria-description",
    "Waiting on 2 tasks",
  );
});

it("does not call a finished task blocked", () => {
  relations.current = { one: { subtasks: 0, subtasksDone: 0, blockedBy: 1 } };
  const { container } = row({ completed: true });
  expect(container.querySelector(".task-row-blocked")).toBeNull();
});

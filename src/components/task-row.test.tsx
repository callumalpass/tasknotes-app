import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import type { Task } from "../domain/task";
import { TaskRow } from "./task-row";
import { createPortal } from "react-dom";
vi.mock("../app/repository-context", () => ({
  useRepository: () => ({
    configuration: defaultTaskCollectionConfiguration(),
  }),
}));
vi.mock("./task-actions", () => ({
  TaskActions: () => (
    <>
      <button type="button" className="task-actions-trigger">
        Actions
      </button>
      {createPortal(<div data-testid="actions-overlay" />, document.body)}
    </>
  ),
}));
vi.mock("./task-property-editor", () => ({
  TaskPropertyEditor: () => <div role="dialog">Edit property</div>,
}));
afterEach(cleanup);
const task = {
  id: "one",
  title: "Write brief",
  scheduled: "2026-08-13",
  due: "2026-08-14",
  status: "open",
  priority: "normal",
  timeEntries: [],
} as unknown as Task;
it("guards repeated completion and offers retry after rejection", async () => {
  let reject!: (reason: Error) => void;
  const toggle = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  render(<TaskRow task={task} onOpen={vi.fn()} onToggle={toggle} />);
  const button = screen.getByRole("button", { name: "Complete Write brief" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(toggle).toHaveBeenCalledOnce();
  expect(button).toBeDisabled();
  reject(new Error("Offline: try again"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Offline: try again",
  );
  expect(button).toBeEnabled();
});
it("opens from blank row space and supporting text, focusing the title", () => {
  const open = vi.fn();
  const { container } = render(
    <TaskRow
      task={task}
      onOpen={open}
      onToggle={vi.fn()}
      supportingText="Matched in notes"
    />,
  );
  const title = screen.getByRole("button", { name: task.title });
  for (const target of [
    container.querySelector(".task-row")!,
    container.querySelector(".task-row-content")!,
    container.querySelector(".task-row-meta")!,
    screen.getByText("Matched in notes"),
  ]) {
    fireEvent.click(target);
    expect(title).toHaveFocus();
  }
  expect(open).toHaveBeenCalledTimes(4);
  expect(open).toHaveBeenLastCalledWith(task, undefined);
});
it("keeps title and independent controls from also opening via the row", () => {
  const open = vi.fn();
  const toggle = vi.fn();
  render(<TaskRow task={task} onOpen={open} onToggle={toggle} />);
  fireEvent.click(screen.getByText(task.title));
  expect(open).toHaveBeenCalledOnce();
  open.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Complete Write brief" }));
  expect(toggle).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: /Scheduled/ }));
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Actions" }));
  fireEvent.click(screen.getByTestId("actions-overlay"));
  expect(open).not.toHaveBeenCalled();
});
it("shows both scheduled and due dates with explicit meanings", () => {
  render(<TaskRow task={task} onOpen={vi.fn()} onToggle={vi.fn()} />);
  expect(screen.getByRole("button", { name: /Scheduled/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /Due/ })).toBeVisible();
});
it("retains date labels and omits routine defaults in saved rows", () => {
  const configuration = defaultTaskCollectionConfiguration();
  render(
    <TaskRow
      task={task}
      onOpen={vi.fn()}
      onToggle={vi.fn()}
      details={[
        {
          key: "note.scheduled",
          label: "Scheduled",
          value: "Aug 13",
          rawValue: task.scheduled,
        },
        { key: "note.due", label: "Due", value: "Aug 14", rawValue: task.due },
        {
          key: "note.status",
          label: "Status",
          value: "Open",
          rawValue: configuration.defaults.status,
        },
        {
          key: "note.priority",
          label: "Priority",
          value: "Normal",
          rawValue: configuration.defaults.priority,
        },
      ]}
    />,
  );
  expect(screen.getByText("Scheduled")).toBeVisible();
  expect(screen.getByText("Due")).toBeVisible();
  expect(screen.queryByText("Normal")).not.toBeInTheDocument();
  expect(screen.queryByText("Open")).not.toBeInTheDocument();
});

import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import type { Task } from "../domain/task";
import { TaskRow } from "./task-row";
import {
  TaskCompletionReportContext,
  TaskDeparturesContext,
} from "./task-completion-motion";
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
it("draws a coloured status as the ring and names it, without a fill", () => {
  const { container, rerender } = render(
    <TaskRow
      task={{ ...task, status: "in-progress" } as Task}
      onOpen={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
  const control = screen.getByRole("button", {
    name: "Complete Write brief, In progress",
  });
  expect(control).toHaveClass("has-status");
  expect(control).toHaveAttribute("title", "In progress");
  expect(control.style.getPropertyValue("--status-color")).toBe("#0066cc");
  rerender(<TaskRow task={task} onOpen={vi.fn()} onToggle={vi.fn()} />);
  const neutral = container.querySelector(".completion-control")!;
  expect(neutral).not.toHaveClass("has-status");
  expect(neutral).not.toHaveAttribute("title");
});
it("animates only a completion made in the row and reports it for Undo", async () => {
  const report = vi.fn();
  let resolve!: () => void;
  const toggle = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const { container, rerender } = render(
    <TaskCompletionReportContext.Provider value={report}>
      <TaskRow task={task} onOpen={vi.fn()} onToggle={toggle} />
    </TaskCompletionReportContext.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Complete Write brief" }));
  resolve();
  await vi.waitFor(() =>
    expect(report).toHaveBeenCalledWith({ task, occurrenceDate: undefined }),
  );
  const done = { ...task, completed: true, status: "done" } as Task;
  rerender(
    <TaskCompletionReportContext.Provider value={report}>
      <TaskRow task={done} onOpen={vi.fn()} onToggle={toggle} />
    </TaskCompletionReportContext.Provider>,
  );
  const row = container.querySelector(".task-row")!;
  expect(row).toHaveClass("is-complete", "is-just-completed");
  // Reopening is not a completion and clears the animation.
  rerender(
    <TaskCompletionReportContext.Provider value={report}>
      <TaskRow task={task} onOpen={vi.fn()} onToggle={toggle} />
    </TaskCompletionReportContext.Provider>,
  );
  expect(row).not.toHaveClass("is-just-completed");
  cleanup();
  const loaded = render(
    <TaskRow task={done} onOpen={vi.fn()} onToggle={vi.fn()} />,
  );
  expect(loaded.container.querySelector(".task-row")).not.toHaveClass(
    "is-just-completed",
  );
  expect(report).toHaveBeenCalledOnce();
});
it("makes a departing row inert and moves keyboard focus to its neighbour", () => {
  const other = { ...task, id: "two", title: "Book room" } as Task;
  const view = (departing: ReadonlyMap<string, number | null>) => (
    <main id="main-content">
      <TaskDeparturesContext.Provider value={departing}>
        <TaskRow task={task} onOpen={vi.fn()} onToggle={vi.fn()} />
        <TaskRow task={other} onOpen={vi.fn()} onToggle={vi.fn()} />
      </TaskDeparturesContext.Provider>
    </main>
  );
  const { container, rerender } = render(view(new Map()));
  const title = screen.getByRole("button", { name: "Write brief" });
  title.focus();
  rerender(view(new Map([["one", Date.now()]])));
  const [departing] = container.querySelectorAll<HTMLElement>(".task-row");
  expect(departing!.inert).toBe(true);
  expect(screen.getByRole("button", { name: "Book room" })).toHaveFocus();
});

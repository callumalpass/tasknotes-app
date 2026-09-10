import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import type { Task } from "../domain/task";
import { TaskRow } from "./task-row";
vi.mock("../app/repository-context", () => ({
  useRepository: () => ({
    configuration: defaultTaskCollectionConfiguration(),
  }),
}));
vi.mock("./task-actions", () => ({ TaskActions: () => null }));
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

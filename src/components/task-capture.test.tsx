import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { TaskCapture } from "./task-capture";

import type { CreateTaskInput, Task } from "../domain/task";

it("applies view defaults and keeps a created task recoverable when the view excludes it", async () => {
  const create = vi.fn(async (input: CreateTaskInput) => task(input));
  const open = vi.fn();

  render(
    <TaskCapture
      configuration={defaultTaskCollectionConfiguration()}
      createTask={create}
      defaults={{ status: "waiting", projects: ["mdbase"] }}
      onCreated={async () => ({
        message: "Task created, but this view does not show it.",
      })}
      onOpenCreated={open}
    />,
  );

  fireEvent.change(screen.getByLabelText("New task title"), {
    target: { value: "Ship the mobile view" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Ship the mobile view",
        status: "waiting",
        projects: ["mdbase"],
      }),
    ),
  );
  expect(
    await screen.findByText("Task created, but this view does not show it."),
  ).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Open task" }));
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Ship the mobile view" }),
  );
});

function task(input: CreateTaskInput): Task {
  return {
    id: "created",
    path: "tasks/created.md",
    title: input.title,
    status: input.status ?? "open",
    priority: input.priority ?? "normal",
    completed: false,
    archived: false,
    body: input.body ?? "",
    createdAt: "2026-07-23T00:00:00Z",
    updatedAt: "2026-07-23T00:00:00Z",
    tags: input.tags ?? [],
    contexts: input.contexts ?? [],
    projects: input.projects ?? [],
    completeInstances: [],
    skippedInstances: [],
    reminders: [],
    timeEntries: [],
    customProperties: input.customProperties ?? {},
    revision: 1,
    frontmatter: {},
  };
}

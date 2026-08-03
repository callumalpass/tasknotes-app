import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { TaskCapture } from "./task-capture";

import type { CreateTaskInput, Task } from "../domain/task";

vi.mock("../domain/task-capture", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../domain/task-capture")>();
  return {
    ...actual,
    parseTaskCapture: vi.fn(async (title: string) => ({
      input: { title },
      preview: [],
    })),
    preloadTaskCapture: vi.fn(),
  };
});

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

it("acknowledges a task immediately while a remote create is pending", async () => {
  const pending = deferred<Task>();
  const create = vi.fn(() => pending.promise);

  render(
    <TaskCapture
      configuration={defaultTaskCollectionConfiguration()}
      createTask={create}
    />,
  );

  const input = screen.getByLabelText<HTMLInputElement>("New task title");
  fireEvent.change(input, { target: { value: "Slow relay task" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  expect(await screen.findByText("Adding “Slow relay task”…")).toBeVisible();
  expect(input).toHaveValue("");

  await act(async () => pending.resolve(task({ title: "Slow relay task" })));

  expect(
    screen.queryByText("Adding “Slow relay task”…"),
  ).not.toBeInTheDocument();
});

it("restores the submitted text when a remote create fails", async () => {
  const create = vi.fn(async () => {
    throw new Error("The relay is unavailable.");
  });

  render(
    <TaskCapture
      configuration={defaultTaskCollectionConfiguration()}
      createTask={create}
    />,
  );

  const input = screen.getByLabelText<HTMLInputElement>("New task title");
  fireEvent.change(input, { target: { value: "Keep this draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  const detail = await screen.findByText(
    "Could not add “Keep this draft”. The relay is unavailable.",
  );
  await act(() => new Promise((resolve) => window.setTimeout(resolve, 120)));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The task could not finish while the collection was unavailable.",
  );
  expect(detail).toBeInTheDocument();
  expect(input).toHaveValue("Keep this draft");
});

it("offers contract-aware inline suggestions with keyboard selection", async () => {
  const complete = vi.fn(async () => [
    {
      kind: "value" as const,
      value: "home",
      label: "Home",
    },
  ]);

  render(
    <TaskCapture
      configuration={defaultTaskCollectionConfiguration()}
      createTask={vi.fn()}
      completeField={complete}
    />,
  );

  const input = screen.getByLabelText<HTMLInputElement>("New task title");
  fireEvent.change(input, {
    target: { value: "Call plumber @ho", selectionStart: 16 },
  });

  expect(await screen.findByRole("option", { name: "Home" })).toBeVisible();
  expect(complete).toHaveBeenCalledWith(
    expect.objectContaining({
      field: "contexts",
      query: "ho",
      limit: 8,
    }),
  );

  fireEvent.keyDown(input, { key: "Enter" });
  expect(input).toHaveValue("Call plumber @home ");
});

it("creates a task with a structured dependency from capture details", async () => {
  const create = vi.fn(async (input: CreateTaskInput) => task(input));
  render(
    <TaskCapture
      configuration={defaultTaskCollectionConfiguration()}
      createTask={create}
      completeField={async (request) =>
        request.field === "blockedBy"
          ? [
              {
                kind: "record",
                label: "Draft proposal",
                value: "[[tasks/Draft proposal]]",
              },
            ]
          : []
      }
    />,
  );

  fireEvent.change(screen.getByLabelText("New task title"), {
    target: { value: "Review proposal" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add details" }));
  fireEvent.focus(await screen.findByRole("combobox", { name: "Blocked by" }));
  fireEvent.click(
    await screen.findByRole("option", { name: /Draft proposal/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        blockedBy: [
          {
            uid: "[[tasks/Draft proposal]]",
            reltype: "FINISHTOSTART",
          },
        ],
      }),
    ),
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
    attachments: input.attachments ?? [],
    blockedBy: input.blockedBy ?? [],
    completeInstances: [],
    skippedInstances: [],
    reminders: [],
    timeEntries: [],
    customProperties: input.customProperties ?? {},
    revision: 1,
    frontmatter: {},
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

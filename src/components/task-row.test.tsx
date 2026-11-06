import { render, screen, cleanup, fireEvent } from "../test/render";
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
    configuration: {
      ...defaultTaskCollectionConfiguration(),
      userFields: [
        {
          id: "energy",
          key: "energy",
          displayName: "Energy level",
          type: "number",
        },
      ],
    },
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
it("keeps priority ink supporting while preserving the collection colour on its flag", () => {
  render(
    <TaskRow
      task={{ ...task, priority: "high" }}
      onOpen={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
  const priority = screen.getByRole("button", { name: "Priority: High" });
  expect(priority.style.color).toBe("");
  expect(priority.querySelector("svg")).toHaveStyle({
    color: defaultTaskCollectionConfiguration().priorities.find(
      (option) => option.value === "high",
    )!.color,
  });
});
it.each([
  ["status", "Status", "In progress", "in-progress"],
  ["priority", "Priority", "High", "high"],
  ["scheduled", "Scheduled", "Tomorrow", "2026-08-13"],
  ["due", "Due", "Tomorrow", "2026-08-13"],
  ["projects", "Projects", "Original", ["[[Projects/Original]]"]],
  ["note.energy", "Energy level", "4", 4],
])(
  "opens the %s row property directly without opening the task",
  (key, label, value, rawValue) => {
    const open = vi.fn();
    render(
      <TaskRow
        task={task}
        onOpen={open}
        onToggle={vi.fn()}
        details={[
          {
            key: key as string,
            label: label as string,
            value: value as string,
            rawValue,
          },
        ]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`^${label}:`) }),
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(open).not.toHaveBeenCalled();
  },
);
const task = {
  id: "one",
  title: "Write brief",
  scheduled: "2026-08-13",
  due: "2026-08-14",
  status: "open",
  priority: "normal",
  timeEntries: [],
} as unknown as Task;
it("puts actionable dates before status and organisational metadata without losing values", () => {
  const { container } = render(
    <TaskRow
      task={task}
      onOpen={vi.fn()}
      onToggle={vi.fn()}
      details={[
        {
          key: "tags",
          label: "Tags",
          value: "research, follow-up",
          rawValue: ["research", "follow-up"],
        },
        {
          key: "status",
          label: "Status",
          value: "A long custom workflow status",
          rawValue: "custom",
        },
        {
          key: "due",
          label: "Due",
          value: "Aug 14",
          rawValue: task.due,
          overdue: true,
        },
      ]}
    />,
  );
  const properties = [...container.querySelectorAll(".task-row-property")];
  expect(
    properties.map((property) => property.getAttribute("aria-label")),
  ).toEqual([
    expect.stringMatching(/^Due:/),
    "Status: A long custom workflow status",
    "Tags: research, follow-up",
  ]);
  expect(properties[0]).toHaveClass("is-date", "is-overdue");
  expect(properties[2]).toHaveClass("is-organisation");
});
it("keeps a parent label available when project properties are omitted", () => {
  const { container } = render(
    <TaskRow
      task={{ ...task, projects: ["[[Tasks/Parent.md|Parent task]]"] }}
      onOpen={vi.fn()}
      onToggle={vi.fn()}
      details={[]}
    />,
  );
  expect(
    container.querySelector(".task-row-properties .is-project"),
  ).toHaveTextContent("Parent task");
  expect(
    container.querySelector(".task-row-properties .is-project"),
  ).not.toHaveTextContent("Tasks/Parent.md");
  fireEvent.click(
    screen.getByRole("button", { name: "Projects: Parent task" }),
  );
  expect(screen.getByRole("dialog")).toBeVisible();
});
it("omits a contextual project but keeps additional memberships in the shared cluster", () => {
  const { container } = render(
    <TaskRow
      task={{
        ...task,
        projects: ["[[Projects/Original]]", "[[Projects/Other]]"],
      }}
      contextProperties={{ 'note["projects"]': "[[Projects/Original]]" }}
      onOpen={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
  expect(container.querySelector(".task-row-meta")).toHaveTextContent("Other");
  expect(container.querySelector(".task-row-meta")).not.toHaveTextContent(
    "Original",
  );
  expect(
    screen.getByRole("button", { name: "Properties for Write brief" }),
  ).toHaveAccessibleDescription(expect.stringContaining("Projects: Other"));
});

it("groups row properties into one Tab stop with arrow and boundary navigation", () => {
  render(
    <TaskRow
      task={{ ...task, priority: "high", projects: ["Operations"] }}
      onOpen={vi.fn()}
      onToggle={vi.fn()}
      details={[
        {
          key: "scheduled",
          label: "Scheduled",
          value: "Nov 4",
          rawValue: "2026-11-04",
        },
        { key: "due", label: "Due", value: "Nov 5", rawValue: "2026-11-05" },
      ]}
    />,
  );
  const toolbar = screen.getByRole("toolbar", {
    name: "Properties for Write brief",
  });
  const buttons = [...toolbar.querySelectorAll("button")];
  expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
  buttons[0].focus();
  fireEvent.keyDown(buttons[0], { key: "ArrowRight" });
  expect(buttons[1]).toHaveFocus();
  expect(buttons[0].tabIndex).toBe(-1);
  fireEvent.keyDown(buttons[1], { key: "End" });
  expect(buttons.at(-1)).toHaveFocus();
  fireEvent.keyDown(buttons.at(-1)!, { key: "Home" });
  expect(buttons[0]).toHaveFocus();
  fireEvent.keyDown(buttons[0], { key: "ArrowLeft" });
  expect(buttons.at(-1)).toHaveFocus();
  fireEvent.click(buttons.at(-1)!);
  expect(screen.getByRole("dialog")).toBeVisible();
});

it("distinguishes a missed deadline from a missed plan without changing dates", () => {
  const view = render(
    <TaskRow
      task={{ ...task, scheduled: "2000-01-01", due: "2000-01-02" }}
      onOpen={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
  expect(view.container.querySelector(".task-row")).toHaveClass(
    "has-missed-deadline",
  );
  view.rerender(
    <TaskRow
      task={{ ...task, scheduled: "2000-01-01", due: undefined }}
      onOpen={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
  expect(view.container.querySelector(".task-row")).not.toHaveClass(
    "has-missed-deadline",
  );
});
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
    container.querySelector(".task-row-context")!,
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
  fireEvent.click(screen.getByRole("button", { name: task.title }));
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
      ensurePriority={false}
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

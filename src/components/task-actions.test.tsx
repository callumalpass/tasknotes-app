import "fake-indexeddb/auto";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "../test/render";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RepositoryProvider } from "../app/repository-context";
import { shiftTaskDate } from "../domain/task-date-actions";
import { todayString } from "../domain/task";
import type { NextTaskRepository } from "../storage/next-repository";
import { nextTaskFixture } from "../test/next-task-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { TaskRow } from "./task-row";
import { TaskActions } from "./task-actions";
import { clearUndoHistory, onUndoNotice, takeUndo } from "../app/undo-history";

import {
  TaskCompletionReportContext,
  type TaskCompletion,
} from "./task-completion-motion";

import type { Task } from "../domain/task";

describe("TaskActions", () => {
  let repository: NextTaskRepository;
  let task: Task;

  beforeEach(async () => {
    ({ repository } = await nextTaskFixture());
    await repository.initialize();
    task = await repository.create({ title: "Menu parent" });
  });

  function renderRow() {
    render(
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        <TaskRow onOpen={vi.fn()} onToggle={vi.fn()} task={task} />
      </RepositoryProvider>,
    );
  }

  async function openMenu() {
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Task actions for Menu parent",
      }),
    );
  }

  it("mounts quick-action tooltips outside the scrolling menu only while active", async () => {
    task = await repository.update(task.id, { scheduled: todayString() });
    renderRow();
    await openMenu();
    const action = screen.getByRole("menuitem", {
      name: "Clear scheduled date",
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(action);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.parentElement).toBe(document.body);
    expect(tooltip).toHaveTextContent("Clear scheduled date");
    fireEvent.mouseLeave(action);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(action);
    expect(screen.getByRole("tooltip")).toBeVisible();
    fireEvent.blur(action);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("copies the task's wikilink and path from the Copy submenu", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    try {
      renderRow();
      await openMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /^Copy/ }));
      fireEvent.click(screen.getByRole("menuitem", { name: /Copy task link/ }));
      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(
          `[[${task.path.replace(/\.md$/, "")}|Menu parent]]`,
        ),
      );
      await openMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: /^Copy/ }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
      await waitFor(() =>
        expect(writeText).toHaveBeenLastCalledWith(task.path),
      );
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("updates contract-defined status, priority, and date shortcuts", async () => {
    renderRow();

    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Status/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "In progress" }));

    await waitFor(async () =>
      expect(await repository.get(task.id)).toMatchObject({
        status: "in-progress",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );

    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Priority/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "High" }));
    await waitFor(async () =>
      expect(await repository.get(task.id)).toMatchObject({
        priority: "high",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );

    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Dates/ }));
    fireEvent.click(screen.getByText("Date options"));
    fireEvent.click(screen.getByRole("radio", { name: "Due" }));
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));

    await waitFor(async () =>
      expect(await repository.get(task.id)).toMatchObject({
        priority: "high",
        due: shiftTaskDate(todayString(), 1),
      }),
    );
  });

  it("opens from a calendar context-menu request without a visible trigger", async () => {
    render(
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        <TaskActions
          contextMenuRequest={{ id: 1, x: 120, y: 80 }}
          task={task}
          onToggle={vi.fn()}
        />
      </RepositoryProvider>,
    );

    expect(
      screen.queryByRole("button", { name: "Task actions for Menu parent" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("menu", { name: "Actions for Menu parent" }),
    ).toBeVisible();
  });

  it("edits a displayed property without opening the task", async () => {
    clearUndoHistory();
    const notice = vi.fn();
    const unsubscribe = onUndoNotice(notice);
    task = await repository.update(task.id, { priority: "high" });
    const onOpen = vi.fn();
    render(
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        <TaskRow onOpen={onOpen} onToggle={vi.fn()} task={task} />
      </RepositoryProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Priority: High" }));
    const editor = screen.getByRole("dialog", { name: "Edit Priority" });
    expect(editor).toBeVisible();
    expect(editor).not.toHaveAttribute("aria-modal");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "High" })).toHaveFocus(),
    );
    fireEvent.click(screen.getByRole("option", { name: "Low" }));

    await waitFor(async () =>
      expect(await repository.get(task.id)).toMatchObject({ priority: "low" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Edit Priority" }),
    ).not.toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledOnce();
    await act(async () => {
      await takeUndo()!.run();
    });
    expect(await repository.get(task.id)).toMatchObject({ priority: "high" });
    unsubscribe();
    clearUndoHistory();
  });

  it("persists date choices without an apply step", async () => {
    task = await repository.update(task.id, { due: "2030-08-05" });
    renderRow();

    fireEvent.click(screen.getByRole("button", { name: /Due: .*Aug 5/ }));
    fireEvent.click(screen.getByRole("button", { name: "Due date" }));
    fireEvent.click(screen.getByRole("gridcell", { name: /August 6, 2030/ }));

    await waitFor(async () =>
      expect(await repository.get(task.id)).toMatchObject({
        due: "2030-08-06",
      }),
    );
    expect(screen.getByRole("dialog", { name: "Edit Due" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Apply|Cancel/ }),
    ).not.toBeInTheDocument();
  });

  it("creates a subtask using the configured portable record link", async () => {
    renderRow();

    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Organize" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Create subtask" }));
    fireEvent.change(screen.getByLabelText("Subtask title"), {
      target: { value: "Menu child" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add subtask" }));

    await waitFor(async () => {
      const child = (await repository.list({ status: "all" })).find(
        (candidate) => candidate.title === "Menu child",
      );
      expect(child?.projects).toEqual([
        `[[${task.path.replace(/\.md$/i, "")}|${task.title}]]`,
      ]);
    });
  });

  it("retries a failed subtask creation with the same intent", async () => {
    const create = vi
      .spyOn(repository, "create")
      .mockRejectedValueOnce(new Error("Lost reply"));
    renderRow();

    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Organize" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Create subtask" }));
    fireEvent.change(screen.getByLabelText("Subtask title"), {
      target: { value: "Retried child" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add subtask" }));
    await screen.findByText("Lost reply");
    fireEvent.click(screen.getByRole("button", { name: "Add subtask" }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[0]![1]).toBeDefined();
    expect(create.mock.calls[1]![1]).toBe(create.mock.calls[0]![1]);
  });

  it("edits organization fields directly from the menu", async () => {
    renderRow();

    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Organize" }));
    expect(screen.getByRole("menuitem", { name: "Projects" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Contexts" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Tags" })).toBeVisible();

    fireEvent.click(screen.getByRole("menuitem", { name: "Projects" }));
    const projects = screen.getByRole("combobox", { name: "Projects" });
    fireEvent.change(projects, { target: { value: "Roadmap" } });
    fireEvent.keyDown(projects, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save projects" }));

    await waitFor(async () =>
      expect(await repository.get(task.id)).toMatchObject({
        projects: ["Roadmap"],
      }),
    );
  });

  it("supports arrow-key traversal and drill-in back navigation", async () => {
    renderRow();
    await openMenu();
    const menu = screen.getByRole("menu", { name: "Actions for Menu parent" });
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Complete" })).toHaveFocus(),
    );

    expect(fireEvent.keyDown(menu, { key: "ArrowDown" })).toBe(false);
    expect(
      screen.getByRole("menuitem", { name: "Complete on another date" }),
    ).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Dates" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(
      screen.getByRole("menuitem", { name: "Schedule today" }),
    ).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowRight" });
    expect(
      screen.getByRole("menuitem", { name: "Schedule tomorrow" }),
    ).toHaveFocus();
    fireEvent.click(screen.getByRole("menuitem", { name: /Status/ }));
    expect(screen.getByText("Status", { selector: "strong" })).toBeVisible();
    fireEvent.keyDown(menu, { key: "ArrowLeft" });
    expect(screen.getByRole("menuitem", { name: /Priority/ })).toBeVisible();
  });

  it("uses an alert dialog and focuses the safe action before deletion", async () => {
    renderRow();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    const confirmation = screen.getByRole("alertdialog", {
      name: "Menu parent",
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Keep task" })).toHaveFocus(),
    );
    expect(screen.getByRole("button", { name: "Delete task" })).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "Delete task" }),
    ).not.toBeInTheDocument();
    expect(confirmation).toHaveAttribute("aria-modal", "true");
    expect(confirmation).toBeVisible();
  });

  it("opens touch Dates at the top with focus on its own heading", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("coarse") || query.includes("max-width"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    try {
      renderRow();
      await openMenu();
      const menu = screen.getByRole("dialog");
      const body = menu.querySelector<HTMLElement>(".task-actions-items")!;
      menu.scrollTop = 228;
      body.scrollTop = 228;
      fireEvent.click(screen.getByRole("menuitem", { name: /Dates/ }));
      const heading = screen.getByText("Dates", { selector: "strong" });
      await waitFor(() => expect(heading).toHaveFocus());
      expect(menu.scrollTop).toBe(0);
      expect(body.scrollTop).toBe(0);
      expect(screen.getByRole("button", { name: "Close" })).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Back to previous actions" }),
      ).toBeVisible();
      fireEvent.keyDown(heading, { key: "Escape" });
      await waitFor(() =>
        expect(screen.getByRole("menuitem", { name: /Dates/ })).toBeVisible(),
      );
      expect(body.scrollTop).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  function renderReportingRow(report: (completion: TaskCompletion) => void) {
    render(
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        <TaskCompletionReportContext.Provider value={report}>
          <TaskRow onOpen={vi.fn()} onToggle={vi.fn()} task={task} />
        </TaskCompletionReportContext.Provider>
      </RepositoryProvider>,
    );
  }

  it("completes a task as of an earlier day and reports it for Undo", async () => {
    const yesterday = shiftTaskDate(todayString(), -1);
    const report = vi.fn();
    renderReportingRow(report);

    await openMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Complete on another date" }),
    );
    const panel = screen.getByRole("dialog", { name: "Menu parent" });
    expect(
      within(panel).getByText("Complete on another date", {
        selector: "strong",
      }),
    ).toBeVisible();
    fireEvent.click(within(panel).getByRole("button", { name: "Yesterday" }));

    await waitFor(async () =>
      expect(await repository.get(task.id)).toMatchObject({
        completed: true,
        completedDate: yesterday,
      }),
    );
    expect(report).toHaveBeenCalledWith({
      task: expect.objectContaining({ id: task.id }),
      on: yesterday,
    });
  });

  it("ticks a late occurrence of a repeating task and keeps its old dates for Undo", async () => {
    const late = shiftTaskDate(todayString(), -3);
    await repository.update(task.id, {
      recurrence: `DTSTART:${late.replaceAll("-", "")};FREQ=DAILY;INTERVAL=1`,
    });
    // Setting the rule moves the plan to the next occurrence; put it back.
    task = await repository.update(task.id, { scheduled: late });
    expect(task.scheduled).toBe(late);
    const report = vi.fn();
    renderReportingRow(report);

    await openMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Complete on another date" }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Menu parent" })).getByRole(
        "button",
        { name: /^Scheduled/ },
      ),
    );

    await waitFor(() => expect(report).toHaveBeenCalled());
    const saved = (await repository.get(task.id))!;
    expect(saved.completed).toBe(false);
    expect(saved.completeInstances).toEqual([late]);
    expect(saved.scheduled).not.toBe(late);
    expect(report).toHaveBeenCalledWith({
      task: expect.objectContaining({ id: task.id }),
      occurrenceDate: late,
      on: late,
      advanced: { scheduled: late, due: null },
    });
  });

  it("offers no other completion date for a finished one-off task", async () => {
    task = await repository.toggle(task.id);
    renderRow();
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "Mark open" })).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "Complete on another date" }),
    ).not.toBeInTheDocument();
  });

  it("keeps occurrence actions separate from series-wide changes", async () => {
    task = await repository.update(task.id, {
      recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260803",
    });
    const onToggle = vi.fn();
    render(
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        <TaskRow
          occurrence={{
            completed: false,
            date: "2026-08-03",
            key: `${task.id}:2026-08-03`,
            skipped: false,
            task,
          }}
          onOpen={vi.fn()}
          onToggle={onToggle}
          task={task}
        />
      </RepositoryProvider>,
    );

    await openMenu();
    expect(
      screen.queryByRole("menuitem", { name: /Status/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Complete occurrence" }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Repeating task actions" }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("menuitem", { name: "Repeating task actions" }),
    );
    expect(screen.getByRole("menuitem", { name: /Status/ })).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Delete repeating task" }),
    ).toBeVisible();
    expect(onToggle).not.toHaveBeenCalled();
  });
});

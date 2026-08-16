import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RepositoryProvider } from "../app/repository-context";
import { shiftTaskDate } from "../domain/task-date-actions";
import { todayString } from "../domain/task";
import { MdbaseTaskRepository } from "../storage/mdbase-repository";
import { createTestMdbaseRepository } from "../test/mdbase-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { TaskRow } from "./task-row";
import { TaskActions } from "./task-actions";

import type { Task } from "../domain/task";

describe("TaskActions", () => {
  let repository: MdbaseTaskRepository;
  let task: Task;

  beforeEach(async () => {
    repository = createTestMdbaseRepository();
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
    fireEvent.click(screen.getByRole("menuitem", { name: "Due tomorrow" }));

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

    fireEvent.click(screen.getByRole("button", { name: "high" }));
    const editor = screen.getByRole("dialog", { name: "Edit Priority" });
    expect(editor).toBeVisible();
    expect(editor).not.toHaveAttribute("aria-modal");
    expect(editor.style.getPropertyValue("--task-property-editor-top")).toBe(
      "12px",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Close property editor" }),
      ).toHaveFocus(),
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Priority" }));
    fireEvent.click(screen.getByRole("option", { name: "Low" }));

    await waitFor(async () =>
      expect(await repository.get(task.id)).toMatchObject({ priority: "low" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Edit Priority" }),
    ).not.toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("persists date choices without an apply step", async () => {
    task = await repository.update(task.id, { due: "2030-08-05" });
    renderRow();

    fireEvent.click(screen.getByRole("button", { name: /Due .*Aug 5/ }));
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
    expect(screen.getByRole("menuitem", { name: "Dates" })).toHaveFocus();
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

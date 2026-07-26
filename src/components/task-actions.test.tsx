import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RepositoryProvider } from "../app/repository-context";
import { shiftTaskDate } from "../domain/task-date-actions";
import { todayString } from "../domain/task";
import { MarkdownCollection } from "../storage/collection";
import { TaskIndex } from "../storage/index";
import { IndexedMarkdownRepository } from "../storage/repository";
import { MemoryVault } from "../test/memory-vault";
import { TaskRow } from "./task-row";

import type { Task } from "../domain/task";

describe("TaskActions", () => {
  let repository: IndexedMarkdownRepository;
  let index: TaskIndex;
  let task: Task;

  beforeEach(async () => {
    index = new TaskIndex(`task-actions-${crypto.randomUUID()}`);
    repository = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(new MemoryVault()),
      index,
    });
    await repository.initialize();
    task = await repository.create({ title: "Menu parent" });
  });

  afterEach(async () => {
    index.close();
    await index.delete();
  });

  function renderRow() {
    render(
      <RepositoryProvider repository={repository}>
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
    fireEvent.click(screen.getByRole("menuitem", { name: "In progress" }));

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
    fireEvent.click(screen.getByRole("menuitem", { name: "High" }));
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
        `[[${task.path.replace(/\.md$/i, "")}]]`,
      ]);
    });
  });

  it("supports arrow-key traversal and drill-in back navigation", async () => {
    renderRow();
    await openMenu();
    const menu = screen.getByRole("menu", { name: "Actions for Menu parent" });
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus(),
    );

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Complete" })).toHaveFocus();
    fireEvent.click(screen.getByRole("menuitem", { name: /Status/ }));
    expect(screen.getByText("Status", { selector: "strong" })).toBeVisible();
    fireEvent.keyDown(menu, { key: "ArrowLeft" });
    expect(screen.getByRole("menuitem", { name: /Priority/ })).toBeVisible();
  });
});

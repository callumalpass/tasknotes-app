import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MarkdownCollection } from "../storage/collection";
import { TaskIndex } from "../storage/index";
import { IndexedMarkdownRepository } from "../storage/repository";
import { MemoryVault } from "../test/memory-vault";
import { RepositoryProvider } from "./repository-context";
import { TaskScreen } from "./task-screen";

import type { Task } from "../domain/task";

describe("TaskScreen persistence failures", () => {
  let repository: IndexedMarkdownRepository;
  let index: TaskIndex;
  let task: Task;

  beforeEach(async () => {
    index = new TaskIndex(`task-screen-${crypto.randomUUID()}`);
    repository = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(new MemoryVault()),
      index,
    });
    await repository.initialize();
    task = await repository.create({ title: "Keep this draft" });
  });

  afterEach(async () => {
    index.close();
    await index.delete();
  });

  function renderTask(onBack = vi.fn()) {
    render(
      <RepositoryProvider repository={repository}>
        <TaskScreen
          id={task.id}
          onBack={onBack}
          onMaterialized={vi.fn()}
        />
      </RepositoryProvider>,
    );
    return onBack;
  }

  async function editTitle() {
    const title = await screen.findByLabelText("Task title", { exact: true });
    fireEvent.change(title, { target: { value: "Unsaved important draft" } });
  }

  it("keeps the editor open when saving before navigation fails", async () => {
    const onBack = renderTask();
    await editTitle();
    vi.spyOn(repository, "update").mockRejectedValueOnce(
      new Error("Connector unavailable"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Save failed/ })).toBeVisible(),
    );
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Task title", { exact: true })).toHaveValue(
      "Unsaved important draft",
    );
  });

  it("does not archive a task after its pending draft fails to save", async () => {
    renderTask();
    await editTitle();
    vi.spyOn(repository, "update").mockRejectedValueOnce(
      new Error("Connector unavailable"),
    );
    const archive = vi.spyOn(repository, "setArchived");

    fireEvent.click(
      screen.getByRole("button", { name: "More task actions" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive task" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Save failed/ })).toBeVisible(),
    );
    expect(archive).not.toHaveBeenCalled();
  });
});

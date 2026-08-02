import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MarkdownCollection } from "../storage/collection";
import { TaskIndex } from "../storage/index";
import { IndexedMarkdownRepository } from "../storage/repository";
import { MemoryVault } from "../test/memory-vault";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { RepositoryProvider } from "./repository-context";
import { TaskScreen } from "./task-screen";

import type { Task } from "../domain/task";

describe("TaskScreen", () => {
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
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        <TaskScreen id={task.id} onBack={onBack} onMaterialized={vi.fn()} />
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

    fireEvent.click(screen.getByRole("button", { name: "More task actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive task" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Save failed/ })).toBeVisible(),
    );
    expect(archive).not.toHaveBeenCalled();
  });

  it("attaches an image as task membership, then inserts it in Notes explicitly", async () => {
    renderTask();
    const file = new File([Uint8Array.of(137, 80, 78, 71)], "receipt.png", {
      type: "image/png",
    });

    fireEvent.change(await screen.findByLabelText("Attach image"), {
      target: { files: [file] },
    });

    expect(await screen.findByText("receipt.png")).toBeVisible();
    const attached = await repository.get(task.id);
    expect(attached?.attachments).toHaveLength(1);
    expect(attached?.frontmatter.attachments).toEqual(attached?.attachments);
    expect(attached?.body).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    await waitFor(async () =>
      expect((await repository.get(task.id))?.body).toMatch(
        /^!\[\[Attachments\//,
      ),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Notes") as HTMLTextAreaElement).value,
      ).toMatch(/^!\[\[Attachments\//),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Delete receipt.png file" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Keep" })).toHaveFocus(),
    );
  });
});

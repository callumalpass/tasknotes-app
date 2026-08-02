import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";

import { MarkdownCollection } from "../storage/collection";
import { TaskIndex } from "../storage/index";
import { IndexedMarkdownRepository } from "../storage/repository";
import { MemoryVault } from "../test/memory-vault";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { RepositoryProvider, useRepository } from "./repository-context";

import type { Task } from "../domain/task";

let repository: IndexedMarkdownRepository;
let index: TaskIndex;
let task: Task;

beforeEach(async () => {
  index = new TaskIndex(`deletion-undo-${crypto.randomUUID()}`);
  repository = new IndexedMarkdownRepository({
    collection: new MarkdownCollection(new MemoryVault()),
    index,
  });
  await repository.initialize();
  task = await repository.create({ title: "Recoverable task" });
});

afterEach(async () => {
  index.close();
  await index.delete();
});

it("keeps the task recoverable during the deletion undo window", async () => {
  render(
    <RepositoryProvider
      mutationJournal={new MemoryMutationJournal()}
      repository={repository}
    >
      <DeletionHarness task={task} />
    </RepositoryProvider>,
  );

  const deleteButton = screen.getByRole("button", {
    name: "Delete test task",
  });
  await waitFor(() => expect(deleteButton).toBeEnabled());
  fireEvent.click(deleteButton);
  await screen.findByText("Deleted Recoverable task");
  expect(await repository.get(task.id)).not.toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Undo deletion" }));
  await waitFor(() =>
    expect(
      screen.queryByText("Deleted Recoverable task"),
    ).not.toBeInTheDocument(),
  );
  expect(await repository.get(task.id)).not.toBeNull();
});

function DeletionHarness({ task }: { task: Task }) {
  const { deleteTask, pendingDeletion, status, undoTaskDeletion } =
    useRepository();
  return (
    <>
      <button
        disabled={status !== "ready"}
        type="button"
        onClick={() => void deleteTask(task.id)}
      >
        Delete test task
      </button>
      {pendingDeletion ? <p>Deleted {pendingDeletion.title}</p> : null}
      <button type="button" onClick={undoTaskDeletion}>
        Undo deletion
      </button>
    </>
  );
}

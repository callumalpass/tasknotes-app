import "fake-indexeddb/auto";

import { act, fireEvent, render, screen, waitFor } from "../test/render";
import { beforeEach, expect, it, vi } from "vitest";

import { MdbaseTaskRepository } from "../storage/mdbase-repository";
import { createTestMdbaseRepository } from "../test/mdbase-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { RepositoryProvider, useRepository } from "./repository-context";

import type { Task } from "../domain/task";

let repository: MdbaseTaskRepository;
let task: Task;

beforeEach(async () => {
  repository = createTestMdbaseRepository();
  await repository.initialize();
  task = await repository.create({ title: "Recoverable task" });
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

it("waits for foreground before committing a deletion whose undo window expired", async () => {
  const deleted = vi.spyOn(repository, "delete");
  const journal = new MemoryMutationJournal();
  render(
    <RepositoryProvider mutationJournal={journal} repository={repository}>
      <DeletionHarness task={task} />
    </RepositoryProvider>,
  );
  const button = screen.getByRole("button", { name: "Delete test task" });
  await waitFor(() => expect(button).toBeEnabled());
  const visibility = vi.spyOn(document, "visibilityState", "get");
  vi.useFakeTimers();
  try {
    await act(async () => {
      fireEvent.click(button);
    });
    expect(journal.snapshot()).toHaveLength(1);
    visibility.mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(deleted).not.toHaveBeenCalled();
    expect(screen.queryByText("cancelled")).not.toBeInTheDocument();
    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(deleted).toHaveBeenCalledExactlyOnceWith(task.id);
    expect(journal.snapshot()).toEqual([]);
  } finally {
    vi.useRealTimers();
    visibility.mockRestore();
  }
});

function DeletionHarness({ task }: { task: Task }) {
  const {
    deleteTask,
    pendingDeletion,
    deletionError,
    status,
    undoTaskDeletion,
  } = useRepository();
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
      {deletionError ? <p>{deletionError.code}</p> : null}
      <button type="button" onClick={undoTaskDeletion}>
        Undo deletion
      </button>
    </>
  );
}

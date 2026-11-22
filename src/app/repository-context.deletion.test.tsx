import "fake-indexeddb/auto";

import { act, fireEvent, render, screen, waitFor } from "../test/render";
import { beforeEach, expect, it, vi } from "vitest";

import type { NextTaskRepository } from "../storage/next-repository";
import { nextTaskFixture } from "../test/next-task-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { RepositoryProvider, useRepository } from "./repository-context";
import { useNavigationTaskCounts } from "./use-navigation-task-counts";

import type { Task } from "../domain/task";

let repository: NextTaskRepository;
let task: Task;

beforeEach(async () => {
  ({ repository } = await nextTaskFixture());
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

it("commits a pending deletion when TaskNotes is hidden and withdraws Undo", async () => {
  const deleted = vi.spyOn(repository, "delete");
  const suspended = vi.spyOn(repository, "suspend");
  const journal = new MemoryMutationJournal();
  render(
    <RepositoryProvider mutationJournal={journal} repository={repository}>
      <DeletionHarness task={task} />
      <InboxCount />
    </RepositoryProvider>,
  );
  const button = screen.getByRole("button", { name: "Delete test task" });
  await waitFor(() => expect(button).toBeEnabled());
  await waitFor(() =>
    expect(screen.getByTestId("inbox-count")).toHaveTextContent("1"),
  );
  const visibility = vi.spyOn(document, "visibilityState", "get");
  // Only the undo window's clock is faked; the replica link keeps running.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    await act(async () => {
      fireEvent.click(button);
      await vi.waitFor(() => expect(journal.snapshot()).toHaveLength(1));
    });
    expect(screen.getByText("Deleted Recoverable task")).toBeInTheDocument();
    expect(deleted).not.toHaveBeenCalled();
    visibility.mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.waitFor(() => expect(journal.snapshot()).toEqual([]));
    });
    // Committed well inside the 30-second window, before suspension.
    expect(deleted).toHaveBeenCalledExactlyOnceWith(task.id);
    expect(suspended).toHaveBeenCalledOnce();
    expect(deleted.mock.invocationCallOrder[0]).toBeLessThan(
      suspended.mock.invocationCallOrder[0]!,
    );
    expect(screen.queryByText("Deleted Recoverable task")).toBeNull();
    expect(screen.queryByText("cancelled")).toBeNull();
    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.queryByText("Deleted Recoverable task")).toBeNull();
    expect(deleted).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
    visibility.mockRestore();
  }
  expect(await repository.get(task.id)).toBeNull();
  await waitFor(() =>
    expect(screen.getByTestId("inbox-count")).toHaveTextContent("0"),
  );
});

it("commits on pagehide when the page goes away without a visibility change", async () => {
  const deleted = vi.spyOn(repository, "delete");
  const journal = new MemoryMutationJournal();
  render(
    <RepositoryProvider mutationJournal={journal} repository={repository}>
      <DeletionHarness task={task} />
    </RepositoryProvider>,
  );
  const button = screen.getByRole("button", { name: "Delete test task" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await screen.findByText("Deleted Recoverable task");
  await act(async () => {
    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(() => expect(journal.snapshot()).toEqual([]));
  });
  expect(deleted).toHaveBeenCalledExactlyOnceWith(task.id);
  expect(screen.queryByText("Deleted Recoverable task")).toBeNull();
});

function InboxCount() {
  const counts = useNavigationTaskCounts();
  return <p data-testid="inbox-count">{counts?.inbox ?? "loading"}</p>;
}

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

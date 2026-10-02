import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createTestMdbaseRepository, taskRecord } from "../test/mdbase-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import type { RepositoryChange } from "../application/ports/task-repository";
import {
  RepositoryProvider,
  useRepository,
  useTasks,
  useRepositoryRevision,
} from "./repository-context";

it("updates connectivity without reloading data queries on status-only events", async () => {
  const repository = createTestMdbaseRepository([
    taskRecord("one", "One", "r1"),
  ]);
  let notify: (change?: RepositoryChange) => void = () => {};
  vi.spyOn(repository, "subscribe").mockImplementation((listener) => {
    notify = listener;
    return () => {};
  });
  const list = vi.spyOn(repository, "listSummaries");
  render(
    <RepositoryProvider
      repository={repository}
      mutationJournal={new MemoryMutationJournal()}
    >
      <Harness />
    </RepositoryProvider>,
  );
  await screen.findByText("One");
  list.mockClear();
  vi.spyOn(repository, "connectionStatus").mockResolvedValue({
    state: "unavailable",
  });
  await act(async () => notify({ kind: "status" }));
  expect(screen.getByText("unavailable")).toBeInTheDocument();
  expect(list).not.toHaveBeenCalled();
  const revision = screen.getByTestId("view-revision").textContent;
  await act(async () => notify({ kind: "lifecycle" }));
  expect(list).not.toHaveBeenCalled();
  expect(screen.getByTestId("view-revision").textContent).not.toBe(revision);
  await act(async () => notify({ kind: "data" }));
  await waitFor(() => expect(list).toHaveBeenCalledOnce());
  list.mockClear();
  await act(async () => notify());
  await waitFor(() => expect(list).toHaveBeenCalledOnce());
});

it("refreshes silently when the window becomes visible again", async () => {
  const repository = createTestMdbaseRepository([
    taskRecord("one", "One", "r1"),
  ]);
  const refresh = vi.spyOn(repository, "refresh");
  render(
    <RepositoryProvider
      repository={repository}
      mutationJournal={new MemoryMutationJournal()}
    >
      <Harness />
    </RepositoryProvider>,
  );
  await screen.findByText("One");
  await waitFor(() =>
    expect(screen.getByText("connected")).toBeInTheDocument(),
  );
  // Let the opening refresh settle before simulating a new foreground session.
  await act(async () => {
    await repository.refresh();
  });
  refresh.mockClear();
  const visibility = vi.spyOn(document, "visibilityState", "get");
  try {
    visibility.mockReturnValue("hidden");
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    visibility.mockReturnValue("visible");
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.getByText("connected")).toBeInTheDocument();
    expect(screen.queryByText("connecting")).toBeNull();
    expect(screen.queryByText("unavailable")).toBeNull();
  } finally {
    visibility.mockRestore();
  }
});

function Harness() {
  const { connection } = useRepository();
  const viewRevision = useRepositoryRevision("view:test");
  const { tasks } = useTasks({ limit: 10 });
  return (
    <>
      <p>{connection.state}</p>
      <p data-testid="view-revision">{viewRevision}</p>
      {tasks.map((task) => (
        <p key={task.id}>{task.title}</p>
      ))}
    </>
  );
}

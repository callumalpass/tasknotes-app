import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createTestMdbaseRepository, taskRecord } from "../test/mdbase-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import type { RepositoryChange } from "../application/ports/task-repository";
import {
  RepositoryProvider,
  useRepository,
  useTasks,
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
  await act(async () => notify({ kind: "data" }));
  await waitFor(() => expect(list).toHaveBeenCalledOnce());
  list.mockClear();
  await act(async () => notify());
  await waitFor(() => expect(list).toHaveBeenCalledOnce());
});

function Harness() {
  const { connection } = useRepository();
  const { tasks } = useTasks({ limit: 10 });
  return (
    <>
      <p>{connection.state}</p>
      {tasks.map((task) => (
        <p key={task.id}>{task.title}</p>
      ))}
    </>
  );
}

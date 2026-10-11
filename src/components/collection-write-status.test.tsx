import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TaskRepository } from "../application/ports/task-repository";
import { CollectionWriteStatus } from "./collection-write-status";
import { RecordWriteNotice } from "./record-write-notice";

afterEach(() => vi.useRealTimers());
const repository = {
  subscribe: () => () => {},
  reconcileWrites: vi.fn(async () => {}),
} as unknown as TaskRepository;

it("escalates only a continuous prolonged wait and clears after acknowledgement", async () => {
  vi.useFakeTimers();
  const view = (pending: number) => (
    <CollectionWriteStatus
      repository={repository}
      connection={{ state: "connected", sync: { text: "", pending, held: 0 } }}
      onReview={() => {}}
    >
      <div>Editor</div>
    </CollectionWriteStatus>
  );
  const { rerender } = render(view(1));
  await act(() => vi.advanceTimersByTime(29_999));
  expect(screen.queryByRole("status")).toBeNull();
  await act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole("status")).toHaveTextContent(
    "Sync is taking longer than usual",
  );
  rerender(view(0));
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByTestId("collection-write-status")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  rerender(view(1));
  expect(screen.queryByText("Syncing…")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});
it("starts a fresh pending grace period when the repository changes", async () => {
  vi.useFakeTimers();
  const view = (current: TaskRepository) => (
    <CollectionWriteStatus
      repository={current}
      connection={{
        state: "connected",
        sync: { text: "", pending: 1, held: 0 },
      }}
      onReview={() => {}}
    >
      <div>Editor</div>
    </CollectionWriteStatus>
  );
  const { rerender } = render(view(repository));
  await act(() => vi.advanceTimersByTime(2_100));
  expect(screen.getByText("Syncing…")).toBeVisible();
  rerender(view({ ...repository }));
  expect(screen.queryByText("Syncing…")).toBeNull();
  await act(() => vi.advanceTimersByTime(1_999));
  expect(screen.queryByText("Syncing…")).toBeNull();
  await act(() => vi.advanceTimersByTime(1));
  expect(screen.getByText("Syncing…")).toBeVisible();
});
it("does not attribute an old collection's late check failure to the new collection", async () => {
  let reject!: (error: Error) => void;
  const old = {
    ...repository,
    writeState: () => "unknown" as const,
    reconcileWrites: () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  };
  const current = { ...repository, writeState: () => "unknown" as const };
  const view = (repo: TaskRepository) => (
    <CollectionWriteStatus
      repository={repo}
      connection={{ state: "connected" }}
      onReview={() => {}}
    >
      <RecordWriteNotice
        repository={repo}
        target={{ kind: "task", id: "original-task" }}
      />
    </CollectionWriteStatus>
  );
  const { rerender } = render(view(old));
  fireEvent.click(screen.getByRole("button", { name: "Check save" }));
  rerender(view(current));
  await act(async () => {
    reject(new Error("Old collection no longer available"));
  });
  expect(screen.getByRole("button", { name: "Check save" })).toBeEnabled();
  expect(screen.queryByText(/Could not check/)).toBeNull();
});
it("deduplicates a task shown in the list, detail and capture confirmation and preserves the review target", () => {
  const target = { kind: "task" as const, id: "original-task" };
  const failed = { ...repository, writeState: () => "failed" as const };
  const onReview = vi.fn();
  render(
    <CollectionWriteStatus
      repository={failed}
      connection={{ state: "connected" }}
      onReview={onReview}
    >
      <div data-testid="row">
        Task title
        <RecordWriteNotice repository={failed} target={target} />
      </div>
      <RecordWriteNotice repository={failed} target={target} />
      <RecordWriteNotice repository={failed} target={target} />
    </CollectionWriteStatus>,
  );
  expect(screen.getAllByTestId("collection-write-status")).toHaveLength(1);
  expect(screen.getByTestId("row")).toHaveTextContent(/^Task title$/);
  expect(screen.queryByText(/changes need review/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review record" }));
  expect(onReview).toHaveBeenCalledWith(target);
});
it("keeps known problems after a row leaves the view and clears only on current metadata", () => {
  let state: "failed" | undefined = "failed";
  const listeners = new Set<() => void>();
  const original = {
    ...repository,
    writeState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const view = (visible: boolean) => (
    <CollectionWriteStatus
      repository={original}
      connection={{ state: "connected" }}
      onReview={() => {}}
    >
      {visible ? (
        <RecordWriteNotice
          repository={original}
          target={{ kind: "task", id: "original-task" }}
        />
      ) : null}
    </CollectionWriteStatus>
  );
  const { rerender, unmount } = render(view(true));
  expect(screen.getByRole("status")).toHaveTextContent("Change rejected");
  rerender(view(false));
  expect(screen.getByRole("status")).toHaveTextContent("Change rejected");
  act(() => {
    state = undefined;
    listeners.forEach((notify) => notify());
  });
  expect(screen.queryByRole("status")).toBeNull();
  unmount();
  expect(listeners.size).toBe(0);
});
it("does not carry an old collection outcome into a new repository", () => {
  const failed = { ...repository, writeState: () => "failed" as const };
  const { rerender } = render(
    <CollectionWriteStatus
      repository={failed}
      connection={{ state: "connected" }}
      onReview={() => {}}
    >
      <RecordWriteNotice
        repository={failed}
        target={{ kind: "task", id: "original-task" }}
      />
    </CollectionWriteStatus>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Change rejected");
  rerender(
    <CollectionWriteStatus
      repository={repository}
      connection={{ state: "connected" }}
      onReview={() => {}}
    >
      <div>Other collection</div>
    </CollectionWriteStatus>,
  );
  expect(screen.queryByRole("status")).toBeNull();
});
it("retains a problem while an explicit readonly check fails", async () => {
  const failed = {
    ...repository,
    writeState: () => "unknown" as const,
    reconcileWrites: vi.fn(async () => {
      throw Error("unavailable");
    }),
  };
  render(
    <CollectionWriteStatus
      repository={failed}
      connection={{ state: "connected" }}
      onReview={() => {}}
    >
      <RecordWriteNotice
        repository={failed}
        target={{ kind: "source", path: "view.base" }}
      />
    </CollectionWriteStatus>,
  );
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Check save" })),
  );
  expect(screen.getByRole("status")).toHaveTextContent("Save outcome unknown");
  expect(screen.getByRole("status")).toHaveTextContent(
    "original changes are retained",
  );
  expect(failed.reconcileWrites).toHaveBeenCalledOnce();
});

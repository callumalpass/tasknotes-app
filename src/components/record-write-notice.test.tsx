import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  RecordWriteStatus,
  RecordWriteTarget,
  TaskRepository,
} from "../application/ports/task-repository";
import { RecordWriteNotice } from "./record-write-notice";

// Component port stand-in only, never native admission/persistence evidence.
function fixture(
  initial?: RecordWriteStatus,
  target: RecordWriteTarget = { kind: "task", id: "task" },
) {
  let state = initial;
  const listeners = new Set<() => void>();
  const reconcile = vi.fn(async () => {});
  const repository = {
    writeState: vi.fn(() => state),
    reconcileWrites: reconcile,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as TaskRepository;
  const view = render(
    <RecordWriteNotice repository={repository} target={target} />,
  );
  return {
    ...view,
    repository,
    reconcile,
    set: (next?: RecordWriteStatus) =>
      act(() => {
        state = next;
        listeners.forEach((fn) => fn());
      }),
    listeners,
  };
}
afterEach(() => vi.useRealTimers());

it("keeps brief local saves silent and uses a non-live overlay after two seconds", async () => {
  vi.useFakeTimers();
  const f = fixture("pending");
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByText("Syncing…")).toBeNull();
  await act(() => vi.advanceTimersByTime(1_999));
  expect(screen.queryByText("Syncing…")).toBeNull();
  await act(() => vi.advanceTimersByTime(1));
  expect(screen.getByText("Syncing…")).toBeVisible();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByTestId("collection-write-status")).toHaveAttribute(
    "aria-live",
    "off",
  );
  f.set();
  expect(screen.queryByText("Syncing…")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});
it("resets the delay between rapid acknowledged edits and cancels timers on unmount", async () => {
  vi.useFakeTimers();
  const f = fixture();
  for (let index = 0; index < 5; index++) {
    f.set("pending");
    await act(() => vi.advanceTimersByTime(1_500));
    expect(screen.queryByText("Syncing…")).toBeNull();
    f.set();
    await act(() => vi.advanceTimersByTime(500));
  }
  f.set("pending");
  await act(() => vi.advanceTimersByTime(1_999));
  expect(screen.queryByText("Syncing…")).toBeNull();
  f.unmount();
  expect(f.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(f.reconcile).not.toHaveBeenCalled();
});
it.each(["failed", "conflicted"] as const)(
  "shows %s without automatic replacement or a write retry",
  (state) => {
    const f = fixture(state);
    expect(screen.getByRole("status")).toHaveTextContent(
      state === "failed" ? "Change rejected" : "Conflicting changes",
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(f.reconcile).not.toHaveBeenCalled();
  },
);
it.each(["scratchpad", "image"] as const)(
  "keeps the original %s metadata target distinct from a source path",
  (kind) => {
    const target = { kind, id: "original-portable-id" };
    const f = fixture("pending", target);
    expect(f.repository.writeState).toHaveBeenCalledWith(target);
    expect(screen.queryByRole("status")).toBeNull();
    f.set("failed");
    expect(screen.getByRole("status")).toHaveTextContent("Change rejected");
    expect(f.reconcile).not.toHaveBeenCalled();
  },
);
it("unknown outcome offers only an explicit read-only check", async () => {
  const f = fixture("unknown");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Check save" }));
  });
  expect(f.reconcile).toHaveBeenCalledOnce();
  expect(screen.getByRole("status")).toHaveTextContent("Save outcome unknown");
});

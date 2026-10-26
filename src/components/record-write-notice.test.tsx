import { act, render, screen } from "../test/render";
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
  const repository = {
    writeState: vi.fn(() => state),
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
    set: (next?: RecordWriteStatus) =>
      act(() => {
        state = next;
        listeners.forEach((fn) => fn());
      }),
    listeners,
  };
}
afterEach(() => vi.useRealTimers());

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
});

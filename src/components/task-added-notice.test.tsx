import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
afterEach(() => vi.useRealTimers());
import type {
  RecordWriteStatus,
  TaskRepository,
} from "../application/ports/task-repository";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { TaskAddedNotice } from "./task-added-notice";

// UI port stand-in, not native acceptance or persistence evidence.
function fixture(initial?: RecordWriteStatus) {
  let state = initial;
  const listeners = new Set<() => void>();
  const reconcile = vi.fn(async () => {});
  const onOpen = vi.fn(),
    onDismiss = vi.fn();
  const task = new TaskNotesTaskModel().create(
    {
      title: "Captured outside the current filter",
    },
    { id: crypto.randomUUID() },
  );
  const repository = {
    writeState: () => state,
    reconcileWrites: reconcile,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as TaskRepository;
  render(
    <TaskAddedNotice
      task={task}
      repository={repository}
      onOpen={onOpen}
      onDismiss={onDismiss}
      aboveMobileControls
    />,
  );
  return {
    reconcile,
    onOpen,
    onDismiss,
    set: (next?: RecordWriteStatus) =>
      act(() => {
        state = next;
        listeners.forEach((notify) => notify());
      }),
  };
}

it("shows late rejection without an Open action to a disappeared create or a replacement submit", () => {
  const f = fixture("pending");
  f.set("failed");
  expect(screen.getByText("Change rejected")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
  expect(f.onOpen).not.toHaveBeenCalled();
  expect(f.reconcile).not.toHaveBeenCalled();
});

it("retains unknown capture and offers only a readonly save check", async () => {
  const f = fixture("unknown");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Check save" }));
  });
  expect(f.reconcile).toHaveBeenCalledOnce();
  expect(screen.getByText("Save outcome unknown")).toBeVisible();
  expect(f.onDismiss).not.toHaveBeenCalled();
});

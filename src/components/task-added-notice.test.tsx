import { act, render, screen } from "@testing-library/react";
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
});

it("retains an unknown capture outcome", () => {
  const f = fixture("unknown");
  expect(screen.getByText("Save outcome unknown")).toBeVisible();
  expect(f.onDismiss).not.toHaveBeenCalled();
});

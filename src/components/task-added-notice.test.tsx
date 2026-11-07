import { act, fireEvent, render, screen, waitFor } from "../test/render";
import { afterEach, expect, it, vi } from "vitest";
import { activateAppLocale } from "../i18n/app";
afterEach(async () => {
  vi.useRealTimers();
  await act(() => activateAppLocale("en"));
});
import type {
  RecordWriteStatus,
  TaskRepository,
} from "../application/ports/task-repository";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { TaskAddedNotice } from "./task-added-notice";

// UI port stand-in, not native acceptance or persistence evidence.
function fixture(
  initial?: RecordWriteStatus,
  title = "Captured outside the current filter",
) {
  let state = initial;
  const listeners = new Set<() => void>();
  const onOpen = vi.fn(),
    onDismiss = vi.fn();
  const onUndo = vi.fn(async () => {});
  const task = new TaskNotesTaskModel().create(
    {
      title,
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
      onUndo={onUndo}
      aboveMobileControls
    />,
  );
  return {
    onOpen,
    onDismiss,
    onUndo,
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

it.each(["en", "de", "it"] as const)(
  "preserves literal backslash sequences in user titles in %s",
  async (locale) => {
    await act(() => activateAppLocale(locale));
    const title = String.raw`C:\x41dir\u0042\u005c — None {title} <0> & 日本語`;
    fixture(undefined, title);
    expect(screen.getByRole("status")).toHaveTextContent(title);
  },
);

it.each(["en", "de", "it"] as const)(
  "renders a lone backslash once, not double-encoded, in %s",
  async (locale) => {
    await act(() => activateAppLocale(locale));
    const title = String.raw`C:\Users\Ada\notes`;
    fixture(undefined, title);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(title);
    expect(status.textContent).not.toContain("u005c");
  },
);

it("retains an unknown capture outcome", () => {
  const f = fixture("unknown");
  expect(screen.getByText("Save outcome unknown")).toBeVisible();
  expect(f.onDismiss).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});

it("undoes the captured task without navigating", async () => {
  const f = fixture();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(f.onDismiss).toHaveBeenCalledOnce());
  expect(f.onUndo).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Captured outside the current filter" }),
  );
  expect(f.onOpen).not.toHaveBeenCalled();
});

it("keeps Open available for fifteen seconds, pausing while hovered or focused", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const open = screen.getByRole("button", { name: "Open" });
  const toast = open.closest(".undo-toast")!;
  await act(async () => vi.advanceTimersByTime(14_999));
  expect(f.onDismiss).not.toHaveBeenCalled();
  fireEvent.pointerEnter(toast);
  await act(async () => vi.advanceTimersByTime(20_000));
  expect(f.onDismiss).not.toHaveBeenCalled();
  await act(async () => open.focus());
  fireEvent.pointerLeave(toast);
  await act(async () => vi.advanceTimersByTime(20_000));
  expect(f.onDismiss).not.toHaveBeenCalled();
  await act(async () => open.blur());
  await act(async () => vi.advanceTimersByTime(15_000));
  expect(f.onDismiss).toHaveBeenCalledOnce();
});

it("stays visible when focus leaves while the pointer remains over it", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const open = screen.getByRole("button", { name: "Open" });
  const toast = open.closest(".undo-toast")!;
  fireEvent.pointerEnter(toast);
  await act(async () => open.focus());
  await act(async () => open.blur());
  await act(async () => vi.advanceTimersByTime(20_000));
  expect(f.onDismiss).not.toHaveBeenCalled();
  fireEvent.pointerLeave(toast);
  await act(async () => vi.advanceTimersByTime(15_000));
  expect(f.onDismiss).toHaveBeenCalledOnce();
});

it("keeps a failed undo visible and permits retry", async () => {
  const f = fixture();
  f.onUndo.mockRejectedValueOnce(new Error("Journal unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Couldn’t undo. Try again.",
    ),
  );
  expect(f.onDismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(f.onDismiss).toHaveBeenCalledOnce());
});

it.each(["pending", "failed", "conflicted"] as const)(
  "does not undo a %s create before its write outcome is resolved",
  (state) => {
    fixture(state);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  },
);

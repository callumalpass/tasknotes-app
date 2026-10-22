import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TaskSummary } from "../domain/task";
import { TaskCompletedNotice } from "./task-completed-notice";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const completion = {
  task: { id: "one", title: "Write brief" } as TaskSummary,
  occurrenceDate: "2026-10-11",
};

it("undoes the completion it names, then dismisses", async () => {
  const undo = vi.fn(async () => undefined);
  const dismiss = vi.fn();
  render(
    <TaskCompletedNotice
      completion={completion}
      aboveMobileControls={false}
      onUndo={undo}
      onDismiss={dismiss}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Completed “Write brief”",
  );
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(undo).toHaveBeenCalledWith(completion);
  await vi.waitFor(() => expect(dismiss).toHaveBeenCalledOnce());
});

it("stays with a retry when Undo fails", async () => {
  const dismiss = vi.fn();
  render(
    <TaskCompletedNotice
      completion={completion}
      aboveMobileControls={false}
      onUndo={() => Promise.reject(new Error("offline"))}
      onDismiss={dismiss}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(
    await screen.findByRole("button", { name: "Try again" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Couldn’t reopen “Write brief”",
  );
  expect(dismiss).not.toHaveBeenCalled();
});

it("leaves on its own unless focus is inside it", () => {
  vi.useFakeTimers();
  const dismiss = vi.fn();
  const { rerender } = render(
    <TaskCompletedNotice
      completion={completion}
      aboveMobileControls={false}
      onUndo={vi.fn()}
      onDismiss={dismiss}
    />,
  );
  act(() => {
    screen.getByRole("button", { name: "Undo" }).focus();
  });
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  expect(dismiss).not.toHaveBeenCalled();
  const next = { task: { id: "two", title: "Book room" } as TaskSummary };
  rerender(
    <TaskCompletedNotice
      completion={next}
      aboveMobileControls={false}
      onUndo={vi.fn()}
      onDismiss={dismiss}
    />,
  );
  act(() => {
    (document.activeElement as HTMLElement).blur();
  });
  act(() => {
    vi.advanceTimersByTime(6_000);
  });
  expect(dismiss).toHaveBeenCalledOnce();
});

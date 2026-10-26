import { act, render, screen } from "../test/render";
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
});

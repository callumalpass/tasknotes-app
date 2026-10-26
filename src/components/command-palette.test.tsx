import { act, cleanup, fireEvent, render, screen } from "../test/render";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import type { PaletteCommand } from "../app/command-palette-model";
import { CommandPalette } from "./command-palette";
import { KeyboardShortcutsSheet } from "./keyboard-shortcuts-sheet";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const commands = (): PaletteCommand[] => [
  { id: "today", label: "Today", section: "navigate", run: vi.fn() },
  { id: "calendar", label: "Calendar", section: "navigate", run: vi.fn() },
  {
    id: "settings",
    label: "Settings",
    section: "navigate",
    keywords: ["preferences"],
    run: vi.fn(),
  },
  {
    id: "new",
    label: "New task",
    section: "actions",
    shortcut: "⌘N",
    run: vi.fn(),
  },
];

function Palette({
  items,
  onClose = vi.fn(),
  taskResults,
}: {
  items: PaletteCommand[];
  onClose?(): void;
  taskResults?: PaletteCommand[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button">Opener</button>
      <CommandPalette
        commands={items}
        open={open}
        query={query}
        taskResults={taskResults}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        onQueryChange={setQuery}
      />
    </>
  );
}

it("focuses a combobox that groups commands and filters as you type", () => {
  render(<Palette items={commands()} />);
  const input = screen.getByRole("combobox", {
    name: "Search commands and tasks",
  });
  expect(input).toHaveFocus();
  expect(screen.getByRole("group", { name: "Go to" })).toBeVisible();
  expect(screen.getByRole("group", { name: "Actions" })).toBeVisible();
  expect(screen.getAllByRole("option")).toHaveLength(4);
  fireEvent.change(input, { target: { value: "prefs" } });
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
    "Settings",
  ]);
  fireEvent.change(input, { target: { value: "zzz" } });
  expect(screen.getByRole("status")).toHaveTextContent("No matching commands.");
});

it("moves the active option with arrows, wrapping, and runs it on Enter", async () => {
  vi.useFakeTimers();
  const items = commands();
  const onClose = vi.fn();
  render(<Palette items={items} onClose={onClose} />);
  const input = screen.getByRole("combobox");
  const selected = () =>
    screen
      .getAllByRole("option")
      .find((option) => option.getAttribute("aria-selected") === "true");
  expect(selected()).toHaveTextContent("Today");
  expect(input).toHaveAttribute("aria-activedescendant", selected()!.id);
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(selected()).toHaveTextContent("New task");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(selected()).toHaveTextContent("Calendar");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onClose).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(items[1].run).not.toHaveBeenCalled();
  await act(() => vi.runAllTimers());
  expect(items[1].run).toHaveBeenCalledOnce();
});

it("lists task results after commands and runs them on click", async () => {
  vi.useFakeTimers();
  const result: PaletteCommand = {
    id: "find:one",
    label: "Write brief",
    section: "tasks",
    detail: "Completed",
    run: vi.fn(),
  };
  render(<Palette items={commands()} taskResults={[result]} />);
  expect(screen.getByRole("group", { name: "Tasks" })).toBeVisible();
  fireEvent.click(screen.getByRole("option", { name: /Write brief/ }));
  await act(() => vi.runAllTimers());
  expect(result.run).toHaveBeenCalledOnce();
});

it("closes on Escape through the overlay stack", () => {
  const onClose = vi.fn();
  render(<Palette items={commands()} onClose={onClose} />);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("shows the shortcut sheet with global and row keys", () => {
  const onClose = vi.fn();
  render(<KeyboardShortcutsSheet open onClose={onClose} />);
  const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
  expect(dialog).toHaveTextContent("Command palette");
  expect(dialog).toHaveTextContent("New task");
  expect(dialog).toHaveTextContent("Undo a deleted task");
  expect(dialog).toHaveTextContent("Schedule next week");
  expect(
    screen.getByRole("button", { name: "Close keyboard shortcuts" }),
  ).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
});

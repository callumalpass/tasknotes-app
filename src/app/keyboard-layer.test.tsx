import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { announceShortcut } from "./keyboard-shortcuts";
import { KeyboardLayer } from "./keyboard-layer";
import type { TaskView } from "../domain/view";

const useTaskSearch = vi.fn<
  (query: unknown) => { tasks: unknown[]; loading: boolean }
>(() => ({ tasks: [], loading: false }));
vi.mock("./repository-context", () => ({
  useTaskSearch: (query: unknown) => useTaskSearch(query),
}));

afterEach(() => {
  cleanup();
  useTaskSearch.mockClear();
});

function renderLayer(paletteRequest = 0) {
  const navigate = vi.fn();
  const newTask = vi.fn();
  const view = (request: number) => (
    <>
      <main id="main-content">
        {["One", "Two"].map((title, index) => (
          <div className="task-row" data-task-id={`t${index}`} key={title}>
            <button className="task-row-title" type="button">
              {title}
            </button>
          </div>
        ))}
        <input aria-label="Notes" />
      </main>
      <KeyboardLayer
        homeKey="today"
        navigate={navigate}
        navigationKeys={["today"]}
        newTask={newTask}
        paletteRequest={request}
        route={{ page: "home" }}
        views={[{ key: "today", name: "Today" } as TaskView]}
      />
    </>
  );
  const result = render(view(paletteRequest));
  return {
    navigate,
    newTask,
    rerender: (request: number) => result.rerender(view(request)),
  };
}

it("moves between rows with j and k and with arrows on a row", () => {
  renderLayer();
  const [one, two] = screen.getAllByRole("button");
  fireEvent.keyDown(document.body, { key: "j" });
  expect(one).toHaveFocus();
  fireEvent.keyDown(one, { key: "j" });
  expect(two).toHaveFocus();
  fireEvent.keyDown(two, { key: "ArrowUp" });
  expect(one).toHaveFocus();
  fireEvent.keyDown(one, { key: "ArrowDown" });
  expect(two).toHaveFocus();
  fireEvent.keyDown(two, { key: "k", altKey: true });
  expect(two).toHaveFocus();
});

it("never moves while typing", () => {
  renderLayer();
  const input = screen.getByRole("textbox", { name: "Notes" });
  input.focus();
  fireEvent.keyDown(input, { key: "j" });
  fireEvent.keyDown(input, { key: "?" });
  expect(input).toHaveFocus();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("opens the shortcut sheet on ? and ignores row keys while it is open", () => {
  renderLayer();
  fireEvent.keyDown(document.body, { key: "?", shiftKey: true });
  const sheet = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
  fireEvent.keyDown(document.activeElement!, { key: "j" });
  expect(sheet).toContainElement(document.activeElement as HTMLElement);
});

it("toggles the palette with Cmd or Ctrl+K and only searches while open", () => {
  renderLayer();
  expect(useTaskSearch).not.toHaveBeenCalled();
  fireEvent.keyDown(document.body, { key: "k", metaKey: true });
  expect(
    screen.getByRole("dialog", { name: "Command palette" }),
  ).toBeInTheDocument();
  expect(useTaskSearch).toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: "k", ctrlKey: true });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("opens the palette when the sidebar asks and runs navigation", async () => {
  vi.useFakeTimers();
  try {
    const { navigate, newTask, rerender } = renderLayer();
    rerender(1);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "new" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(() => vi.runAllTimers());
    expect(newTask).toHaveBeenCalledOnce();
    rerender(2);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "today" },
    });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    await act(() => vi.runAllTimers());
    expect(navigate).toHaveBeenCalledWith({ page: "home" });
  } finally {
    vi.useRealTimers();
  }
});

it("announces row actions politely, repeating identical messages", () => {
  const { container } = render(
    <KeyboardLayer
      navigate={vi.fn()}
      navigationKeys={[]}
      newTask={vi.fn()}
      paletteRequest={0}
      route={{ page: "home" }}
      views={[]}
    />,
  );
  const region = container.querySelector("[aria-live='polite']")!;
  act(() => announceShortcut("Completed One."));
  expect(region).toHaveTextContent("Completed One.");
  const first = region.textContent;
  act(() => announceShortcut("Completed One."));
  expect(region.textContent).not.toBe(first);
});

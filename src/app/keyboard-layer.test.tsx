import { act, cleanup, fireEvent, render, screen } from "../test/render";
import { afterEach, expect, it, vi } from "vitest";

import { announceShortcut } from "./keyboard-shortcuts";
import { KeyboardLayer } from "./keyboard-layer";
import type { Route } from "./use-workspace-navigation";
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

function renderLayer(paletteRequest = 0, route: Route = { page: "home" }) {
  const navigate = vi.fn();
  const newTask = vi.fn();
  const toggleSidebar = vi.fn();
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
        toggleSidebar={toggleSidebar}
        paletteRequest={request}
        route={route}
        views={[{ key: "today", id: "today", name: "Today" } as TaskView]}
      />
    </>
  );
  const result = render(view(paletteRequest));
  return {
    navigate,
    newTask,
    toggleSidebar,
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

it("captures with q/n, toggles the rail with Shift M, and guards plain keys", () => {
  const { newTask, toggleSidebar, navigate } = renderLayer();
  for (const key of ["q", "n"]) fireEvent.keyDown(document.body, { key });
  expect(newTask).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(document.body, { key: "m" });
  expect(toggleSidebar).not.toHaveBeenCalled();
  const row = screen.getByRole("button", { name: "One" });
  row.focus();
  fireEvent.keyDown(row, { key: "m" });
  expect(toggleSidebar).not.toHaveBeenCalled();
  fireEvent.keyDown(row, { key: "M", shiftKey: true });
  expect(toggleSidebar).toHaveBeenCalledTimes(1);
  const input = screen.getByRole("textbox");
  for (const key of ["q", "n", "/", "g", "M"]) {
    fireEvent.keyDown(input, { key });
    fireEvent.keyDown(document.body, { key, altKey: true });
    fireEvent.keyDown(document.body, { key, isComposing: true });
  }
  expect(newTask).toHaveBeenCalledTimes(2);
  expect(toggleSidebar).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
});

it("consumes g t before a focused row can schedule and expires or cancels prefixes", () => {
  vi.useFakeTimers();
  try {
    const { navigate } = renderLayer();
    const row = screen.getByRole("button", { name: "One" });
    const schedule = vi.fn();
    row.addEventListener("keydown", schedule);
    row.focus();
    fireEvent.keyDown(row, { key: "g" });
    schedule.mockClear();
    fireEvent.keyDown(row, { key: "t" });
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ page: "home" });
    expect(schedule).not.toHaveBeenCalled();
    navigate.mockClear();
    fireEvent.keyDown(row, { key: "g" });
    vi.advanceTimersByTime(1_001);
    fireEvent.keyDown(row, { key: "t" });
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.keyDown(row, { key: "g" });
    screen.getByRole("textbox").focus();
    row.focus();
    fireEvent.keyDown(row, { key: "t" });
    expect(navigate).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("focuses Search and suspends capture and navigation while an overlay is open", () => {
  const { navigate, newTask, toggleSidebar } = renderLayer();
  fireEvent.keyDown(document.body, { key: "/" });
  expect(navigate).toHaveBeenCalledWith({ page: "search" });
  const search = screen.getByRole("textbox");
  search.setAttribute("type", "search");
  fireEvent.keyDown(document.body, { key: "/" });
  expect(search).toHaveFocus();
  search.blur();
  navigate.mockClear();
  fireEvent.keyDown(document.body, { key: "?" });
  for (const key of ["q", "n", "/", "g", "t", "M"])
    fireEvent.keyDown(document.activeElement!, { key });
  expect(navigate).not.toHaveBeenCalled();
  expect(newTask).not.toHaveBeenCalled();
  expect(toggleSidebar).not.toHaveBeenCalled();
});

it("leaves the detail route for Search even when the underlying workspace has a search field", () => {
  const { navigate } = renderLayer(0, { page: "task", id: "t0" });
  screen.getByRole("textbox").setAttribute("type", "search");
  fireEvent.keyDown(document.body, { key: "/" });
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ page: "search" });
});

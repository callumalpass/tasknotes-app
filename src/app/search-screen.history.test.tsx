import { cleanup, fireEvent, render, screen, waitFor } from "../test/render";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SearchScreen } from "./search-screen";
import { historyScope, readHistory, rememberHistory } from "./search-history";

const info = {
  kind: "connect" as const,
  id: "demo",
  name: "Demo",
  location: "demo",
  runtime: "browser" as const,
};
const scope = historyScope(info);
const fixture = vi.hoisted(() => ({
  query: vi.fn(),
  get: vi.fn(),
}));
vi.mock("./repository-context", () => ({
  useRepository: () => ({
    setTaskCompletion: vi.fn(),
    status: "ready",
    repository: {
      collectionInfo: () => Promise.resolve(info),
      get: fixture.get,
    },
  }),
  useTaskSearch: fixture.query,
}));
vi.mock("./use-people", () => ({ usePeople: () => ({ supported: false }) }));
vi.mock("../components/task-row", () => ({
  TaskRow: ({
    task,
    onOpen,
  }: {
    task: { title: string };
    onOpen(task: unknown): void;
  }) => (
    <button type="button" onClick={() => onOpen(task)}>
      {task.title}
    </button>
  ),
}));

beforeEach(() => {
  fixture.query.mockReturnValue({ tasks: [], retry: vi.fn() });
  fixture.get.mockImplementation((id: string) =>
    Promise.resolve(
      id === "tasks/gone.md" ? null : { id, title: `Task ${id}`, body: "" },
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

it("shows nothing extra when there is no history", async () => {
  render(<SearchScreen onOpen={vi.fn()} />);
  await waitFor(() => expect(screen.getByText("Find a task.")).toBeVisible());
  expect(screen.queryByText("Recent searches")).toBeNull();
  expect(screen.queryByText("Recently opened")).toBeNull();
});

it("offers recent searches, reuses one, and can clear them", async () => {
  rememberHistory("searches", scope, "older");
  rememberHistory("searches", scope, "newer");
  render(<SearchScreen onOpen={vi.fn()} />);
  const section = await screen.findByRole("region", {
    name: "Recent searches",
  });
  expect(section).toHaveTextContent(/newer.*older/);
  fireEvent.click(screen.getByRole("button", { name: "newer" }));
  expect(screen.getByRole("searchbox")).toHaveValue("newer");
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Clear recent searches" }),
  );
  expect(screen.queryByText("Recent searches")).toBeNull();
  expect(readHistory("searches", scope)).toEqual([]);
  expect(screen.getByRole("searchbox")).toHaveFocus();
});

it("remembers a search when it is submitted or a result is opened", async () => {
  fixture.query.mockImplementation(({ search }: { search: string }) => ({
    tasks: search
      ? [{ task: { id: "tasks/a.md", title: "Plan A" }, bodyMatches: [] }]
      : [],
    retry: vi.fn(),
  }));
  const onOpen = vi.fn();
  render(<SearchScreen onOpen={onOpen} />);
  await waitFor(() => expect(fixture.get).not.toHaveBeenCalled());
  const box = screen.getByRole("searchbox");
  fireEvent.change(box, { target: { value: "plan" } });
  await waitFor(() => expect(readHistory("searches", scope)).toEqual([]));
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(readHistory("searches", scope)).toEqual(["plan"]));
  fireEvent.change(box, { target: { value: "Plan A" } });
  fireEvent.click(await screen.findByRole("button", { name: "Plan A" }));
  expect(onOpen).toHaveBeenCalled();
  expect(readHistory("searches", scope)).toEqual(["Plan A", "plan"]);
});

it("lists recently opened tasks, opens them, and drops deleted ones", async () => {
  rememberHistory("tasks", scope, "tasks/gone.md");
  rememberHistory("tasks", scope, "tasks/one.md");
  const onOpen = vi.fn();
  render(<SearchScreen onOpen={onOpen} />);
  const task = await screen.findByRole("button", { name: "Task tasks/one.md" });
  expect(screen.queryByText("Task tasks/gone.md")).toBeNull();
  await waitFor(() =>
    expect(readHistory("tasks", scope)).toEqual(["tasks/one.md"]),
  );
  fireEvent.click(task);
  expect(onOpen).toHaveBeenCalledWith(
    expect.objectContaining({ id: "tasks/one.md" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Clear recently opened tasks" }),
  );
  expect(screen.queryByText("Recently opened")).toBeNull();
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SearchScreen } from "./search-screen";
const fixture = vi.hoisted(() => ({ query: vi.fn(), retry: vi.fn() }));
vi.mock("./repository-context", () => ({
  useRepository: () => ({ setTaskCompletion: vi.fn() }),
  useTasks: fixture.query,
}));
vi.mock("../components/task-row", () => ({
  TaskRow: ({ task }: { task: { title: string } }) => <div>{task.title}</div>,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function search() {
  render(<SearchScreen onOpen={vi.fn()} />);
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "Match" },
  });
}
it("shows an actionable error rather than pretending a failed search was empty", async () => {
  fixture.query.mockReturnValue({
    tasks: [],
    error: new Error("Authority unavailable"),
    retry: fixture.retry,
  });
  search();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Authority unavailable",
  );
  expect(screen.queryByText("No tasks matched.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry search" }));
  expect(fixture.retry).toHaveBeenCalledOnce();
});
it("labels stale results instead of silently presenting them as current", async () => {
  fixture.query.mockReturnValue({
    tasks: [{ id: "one", title: "Match old" }],
    stale: true,
    error: new Error("Offline"),
    retry: fixture.retry,
  });
  search();
  expect(await screen.findByText("Match old")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Previously loaded results may be out of date",
  );
});
it("does not claim an exact total at the prefix boundary and can request more", async () => {
  fixture.query.mockReturnValue({
    tasks: Array.from({ length: 301 }, (_, index) => ({
      id: String(index),
      title: `Match ${index}`,
    })),
    retry: fixture.retry,
  });
  search();
  expect(await screen.findByText("300+ tasks")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Show more results" }));
  expect(fixture.query).toHaveBeenLastCalledWith(
    expect.objectContaining({ limit: 601 }),
  );
});

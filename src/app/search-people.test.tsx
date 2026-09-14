import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SearchScreen } from "./search-screen";
const fixture = vi.hoisted(() => ({
  query: vi.fn(),
  people: {} as Record<string, unknown>,
}));
vi.mock("./repository-context", () => ({
  useRepository: () => ({ setTaskCompletion: vi.fn() }),
  useTasks: fixture.query,
}));
vi.mock("./use-people", () => ({
  usePeople: () => ({ supported: true, retry: vi.fn(), ...fixture.people }),
}));
vi.mock("../components/task-row", () => ({ TaskRow: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fixture.people = {};
});
function chooseMine() {
  fixture.query.mockReturnValue({
    tasks: [],
    loading: false,
    refreshing: false,
    retry: vi.fn(),
  });
  render(<SearchScreen onOpen={vi.fn()} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Assigned to me" }));
}
it("queries by the resolved person ID, not the account subject", () => {
  fixture.people = {
    directory: { current: { status: "linked", personId: "person_one" } },
  };
  chooseMine();
  expect(fixture.query).toHaveBeenLastCalledWith(
    expect.objectContaining({ assignee: "person_one", limit: 301 }),
  );
  expect(screen.getByText("No matching tasks assigned to you.")).toBeVisible();
});
it("does not mistake an unlinked account for an empty assignment search", () => {
  fixture.people = {
    directory: {
      current: { status: "unlinked" },
      profileUrl: "https://connect.example",
    },
  };
  chooseMine();
  expect(
    screen.getByText(/Link your account to a person record/),
  ).toBeVisible();
  expect(screen.queryByText("No matching tasks assigned to you.")).toBeNull();
  expect(fixture.query).toHaveBeenLastCalledWith(
    expect.objectContaining({ limit: 0 }),
  );
});
it("explains ambiguity and discovery failures instead of guessing", () => {
  fixture.people = { error: new Error("Identity permission denied") };
  chooseMine();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Identity permission denied",
  );
  expect(screen.queryByText("No matching tasks assigned to you.")).toBeNull();
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SearchScreen } from "./search-screen";
const fixture = vi.hoisted(() => ({
  query: vi.fn(),
  people: {} as Record<string, unknown>,
}));
vi.mock("./repository-context", () => ({
  useRepository: () => ({ setTaskCompletion: vi.fn() }),
  useTaskSearch: fixture.query,
}));
vi.mock("./use-people", () => ({
  usePeople: () => ({
    supported: true,
    retry: vi.fn(),
    openedSettings: vi.fn(),
    ...fixture.people,
  }),
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
it("queries by the resolved person record, not the account subject", () => {
  fixture.people = {
    directory: { current: { status: "linked", personPath: "people/me.md" } },
  };
  chooseMine();
  expect(fixture.query).toHaveBeenLastCalledWith(
    expect.objectContaining({ assignedTo: "people/me.md", limit: 301 }),
  );
  expect(screen.getByText("No matching tasks assigned to you.")).toBeVisible();
});
it("does not mistake an unlinked account for an empty assignment search", () => {
  fixture.people = {
    directory: {
      current: { status: "unlinked" },
      settingsUrl: "https://editor.example/?surface=settings#your-person",
    },
  };
  chooseMine();
  expect(
    screen.getByText(/Link your account to a person record/),
  ).toBeVisible();
  const setup = screen.getByRole("link", {
    name: /Choose or create your person record/,
  });
  expect(setup).toHaveAttribute("target", "_blank");
  expect(setup).toHaveAttribute("rel", "noopener noreferrer");
  expect(setup).toHaveClass("people-profile-link");
  expect(screen.getByRole("button", { name: "Reload people" })).toHaveClass(
    "people-action",
  );
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

it("names the records to fix when the account resolves to invalid or ambiguous records", () => {
  fixture.people = {
    directory: { current: { status: "invalid", paths: ["people/me.md"] } },
  };
  chooseMine();
  expect(screen.getByText(/needs fixing.*people\/me\.md/)).toBeVisible();
  expect(screen.queryByRole("link")).toBeNull();
  cleanup();
  fixture.people = {
    directory: { current: { status: "ambiguous", paths: ["a.md", "b.md"] } },
  };
  chooseMine();
  expect(screen.getByText(/a\.md, b\.md/)).toBeVisible();
});

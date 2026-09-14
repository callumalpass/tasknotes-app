import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AssigneeEditor } from "./assignee-editor";
const state = vi.hoisted(() => ({
  directory: undefined as unknown,
  error: undefined as Error | undefined,
  retry: vi.fn(),
}));
vi.mock("../app/use-people", () => ({
  usePeople: () => ({ ...state, supported: true }),
}));
afterEach(() => {
  cleanup();
  state.directory = undefined;
  state.error = undefined;
  vi.clearAllMocks();
});
it("retains unresolved assignments when the directory fails", () => {
  state.error = new Error("Offline");
  const change = vi.fn();
  render(<AssigneeEditor values={["person_missing"]} onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Choose assignees" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Existing assignments are unchanged",
  );
  expect(screen.getByText("Person · person_missing")).toBeVisible();
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Remove assignment/ }));
  expect(change).toHaveBeenCalledWith([]);
});
it("offers active unique collaborators and stores person IDs rather than account subjects", () => {
  state.directory = {
    profileUrl: "https://connect.example",
    people: [
      {
        id: "person_one",
        name: "Callum",
        path: "people/callum.md",
        activeMember: true,
        ambiguousId: false,
      },
      {
        id: "former",
        name: "Former",
        path: "former.md",
        activeMember: false,
        ambiguousId: false,
      },
      {
        id: "ambiguous_account",
        name: "Ambiguous account",
        path: "ambiguous.md",
        activeMember: true,
        ambiguousId: false,
        ambiguousIdentity: true,
      },
      {
        id: "duplicate",
        name: "Duplicate",
        path: "duplicate.md",
        activeMember: true,
        ambiguousId: true,
      },
    ],
  };
  const change = vi.fn();
  render(<AssigneeEditor values={[]} onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Choose assignees" }));
  expect(screen.getAllByRole("option")).toHaveLength(2);
  fireEvent.change(screen.getByRole("combobox", { name: "Add an assignee" }), {
    target: { value: "person_one" },
  });
  expect(change).toHaveBeenCalledWith(["person_one"]);
});

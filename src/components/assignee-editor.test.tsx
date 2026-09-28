import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AssigneeEditor } from "./assignee-editor";
const state = vi.hoisted(() => ({
  directory: undefined as unknown,
  error: undefined as Error | undefined,
  retry: vi.fn(),
  openedSettings: vi.fn(),
  targets: undefined as Map<string, string | null> | undefined,
}));
vi.mock("../app/use-people", () => ({
  usePeople: () => ({ ...state, supported: true }),
  useAssigneeTargets: () => state.targets,
}));
afterEach(() => {
  cleanup();
  state.directory = undefined;
  state.error = undefined;
  state.targets = undefined;
  vi.clearAllMocks();
});
const person = (name: string, path: string, extra = {}) => ({
  name,
  path,
  activeMember: true,
  ambiguousIdentity: false,
  ...extra,
});
function renderEditor(
  values: string[],
  linkWriteFormat: "wikilink" | "markdown" = "wikilink",
) {
  const change = vi.fn();
  render(
    <AssigneeEditor
      taskId="tasks/a.md"
      values={values}
      linkWriteFormat={linkWriteFormat}
      onChange={change}
    />,
  );
  return change;
}

it("retains assignments and shows their link text when people cannot load", () => {
  state.error = new Error("Offline");
  const change = renderEditor(["[[Former teammate]]"]);
  fireEvent.click(screen.getByRole("button", { name: "Choose assignees" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Existing assignments are unchanged",
  );
  expect(screen.getByText("Former teammate")).toBeVisible();
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Remove assignment/ }));
  expect(change).toHaveBeenCalledWith([]);
});

it("labels saved links by the record mdbase resolved them to", () => {
  state.directory = {
    people: [
      person("Alex Rivera", "people/alex.md"),
      person("Former", "people/former.md", { activeMember: false }),
      person("Shared", "people/shared.md", { ambiguousIdentity: true }),
    ],
  };
  state.targets = new Map<string, string | null>([
    ["[[people/alex|Alex]]", "people/alex.md"],
    ["[[Former]]", "people/former.md"],
    ["[[Shared]]", "people/shared.md"],
    ["[[Nobody]]", null],
    ["[[Some project]]", "projects/some.md"],
  ]);
  renderEditor([...state.targets.keys()]);
  for (const text of [
    "Alex Rivera",
    "Former (not linked to an active member)",
    "Shared (ambiguous account link)",
    "Nobody (no matching person record)",
    "Some project (not a person record)",
  ])
    expect(screen.getByText(text)).toBeVisible();
});

it("writes a link to the chosen person record and offers only unassigned, unambiguous people", () => {
  state.directory = {
    settingsUrl: "https://editor.example/?surface=settings#your-person",
    people: [
      person("Alex Rivera", "people/Alex Rivera.md"),
      person("Already assigned", "people/assigned.md"),
      person("Former", "people/former.md", { activeMember: false }),
      person("Shared", "people/shared.md", { ambiguousIdentity: true }),
    ],
  };
  state.targets = new Map([["[[people/assigned]]", "people/assigned.md"]]);
  const change = renderEditor(["[[people/assigned]]"]);
  fireEvent.click(screen.getByRole("button", { name: "Choose assignees" }));
  const setup = screen.getByRole("link", {
    name: /Choose or create your person record/,
  });
  expect(setup).toHaveAttribute("target", "_blank");
  expect(setup).toHaveAttribute("rel", "noopener noreferrer");
  fireEvent.click(setup);
  expect(state.openedSettings).toHaveBeenCalledOnce();
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["Choose a person…", "Alex Rivera · people/Alex Rivera.md"]);
  fireEvent.change(screen.getByRole("combobox", { name: "Add an assignee" }), {
    target: { value: "people/Alex Rivera.md" },
  });
  expect(change).toHaveBeenCalledWith([
    "[[people/assigned]]",
    "[[people/Alex Rivera]]",
  ]);
});

it("uses the collection's Markdown link format when configured", () => {
  state.directory = {
    people: [person("Alex Rivera", "people/Alex Rivera.md")],
  };
  const change = renderEditor([], "markdown");
  fireEvent.click(screen.getByRole("button", { name: "Choose assignees" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Add an assignee" }), {
    target: { value: "people/Alex Rivera.md" },
  });
  expect(change).toHaveBeenCalledWith([
    "[Alex Rivera](/people/Alex%20Rivera.md)",
  ]);
});

it("offers every unambiguous person when the member directory was not shared", () => {
  state.directory = {
    people: [
      { name: "Alex", path: "alex.md", ambiguousIdentity: false },
      { name: "Sam", path: "sam.md", ambiguousIdentity: false },
    ],
  };
  renderEditor([]);
  fireEvent.click(screen.getByRole("button", { name: "Choose assignees" }));
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["Choose a person…", "Alex · alex.md", "Sam · sam.md"]);
  expect(screen.queryByRole("link")).toBeNull();
});

it("offers people without a linked account even when membership is shared", () => {
  state.directory = {
    people: [
      person("Former", "people/former.md", { activeMember: false }),
      { name: "Bob", path: "people/bob.md", ambiguousIdentity: false },
    ],
  };
  state.targets = new Map([["[[people/bob]]", "people/bob.md"]]);
  renderEditor(["[[people/bob]]"]);
  expect(screen.getByText("Bob")).toBeVisible();
  cleanup();
  renderEditor([]);
  fireEvent.click(screen.getByRole("button", { name: "Choose assignees" }));
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["Choose a person…", "Bob · people/bob.md"]);
});

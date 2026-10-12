import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { expect, it, vi } from "vitest";
import { createTestMdbase, type TestMdbase } from "@mdbase-dev/sdk/testing";

const starterViews = vi.hoisted(() => vi.fn(async () => []));
vi.mock("../application/ensure-default-view-source", () => ({
  addTaskNotesStarterViews: starterViews,
}));
vi.mock("../storage/next-repository", () => ({
  NextTaskRepository: class {
    constructor(readonly records: unknown) {}
    taskConfiguration = async () => ({});
    dispose() {}
  },
}));
vi.mock("../demo/demo-app", () => {
  throw new Error("Production entry must not import the demo app");
});

import { TaskNotesApp } from "./tasknotes-app";

function testMdbase() {
  return createTestMdbase({
    collections: [{ name: "Alpha" }, { name: "Beta" }],
  });
}

const collectionId = (mdbase: TestMdbase, index: number) =>
  mdbase.getSnapshot().collections[index]!.collectionId;

/** The Connect window is open; approving in it adds and opens `id`. */
function approveAdded(mdbase: TestMdbase, id: string) {
  const { controls, application } = mdbase.fixture;
  const before = application.getSnapshot();
  const collection = before.collections.find((c) => c.collectionId === id);
  act(() =>
    controls.publishSnapshot({
      ...before,
      status: "authorizing",
      selection: { ...before.selection, state: "approving" },
    } as never),
  );
  controls.setHandler(
    "approve",
    () =>
      ({
        ...before,
        selectedCollectionId: id,
        selection: {
          ...before.selection,
          usable: collection,
          requested: { ...before.selection.requested, collectionId: id },
          lastApproval: { kind: "add", outcome: "added", collectionId: id },
        },
      }) as never,
  );
}

function Workspace({
  repository,
}: {
  repository: { records: { collection: string } };
}) {
  return <main>Workspace {repository.records.collection}</main>;
}

it("adds starter views to the collection an approval opened, not on opening", async () => {
  starterViews.mockClear();
  const mdbase = await testMdbase();
  const [a, b] = [collectionId(mdbase, 0), collectionId(mdbase, 1)];
  render(
    <StrictMode>
      <TaskNotesApp mdbase={mdbase} Workspace={Workspace as never} />
    </StrictMode>,
  );
  expect(await screen.findByText(`Workspace ${a}`)).toBeVisible();

  approveAdded(mdbase, b);
  expect(
    screen.getByRole("heading", { name: "Continue in the mdbase window" }),
  ).toBeVisible();
  await act(() => mdbase.addCollection());
  expect(await screen.findByText(`Workspace ${b}`)).toBeVisible();
  await waitFor(() => expect(starterViews).toHaveBeenCalledOnce());
  expect(starterViews).toHaveBeenCalledWith(
    expect.objectContaining({ records: mdbase.fixture.client(b) }),
    {},
    { onlyIfNoViews: true },
  );

  // Switching back is navigation: nothing is written.
  await act(() => mdbase.select(a));
  expect(await screen.findByText(`Workspace ${a}`)).toBeVisible();
  expect(starterViews).toHaveBeenCalledOnce();
});

it("signs out through the SDK and never just closes the entry", async () => {
  const mdbase = await testMdbase();
  mdbase.fixture.set("choosing");
  window.history.replaceState(null, "", "/?demo=50");
  render(<TaskNotesApp mdbase={mdbase} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  await waitFor(() =>
    expect(mdbase.getSnapshot().phase.kind).toBe("signed_out"),
  );
  const actions = mdbase.fixture.controls
    .observedActions()
    .map((call) => call.action);
  expect(actions).toContain("signOut");
  expect(actions).not.toContain("close");
});

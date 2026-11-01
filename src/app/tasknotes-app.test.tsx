import { act, fireEvent, render, screen, waitFor } from "../test/render";
import { StrictMode } from "react";
import { expect, it, vi } from "vitest";
import { createTestMdbase, type TestMdbase } from "@mdbase-dev/sdk/testing";
import type { MdbaseSetupPlan } from "@mdbase-dev/sdk";
import {
  CollectionSwitcher,
  type CollectionUiOptions,
} from "@mdbase-dev/ui/collections";

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
  const before = mdbase.fixture.application.getSnapshot();
  act(() =>
    mdbase.fixture.controls.publishSnapshot({
      ...before,
      status: "authorizing",
      selection: { ...before.selection, state: "approving" },
    } as never),
  );
  approvalAdds(mdbase, id, before);
}

/** The next approval, whoever starts it, adds and opens `id`. */
function approvalAdds(
  mdbase: TestMdbase,
  id: string,
  before = mdbase.fixture.application.getSnapshot(),
) {
  const { controls } = mdbase.fixture;
  const collection = before.collections.find((c) => c.collectionId === id);
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

function SwitcherWorkspace({
  actions,
  repository,
}: {
  actions: { collectionUi: CollectionUiOptions };
  repository: { records: { collection: string } };
}) {
  return (
    <main>
      <CollectionSwitcher {...actions.collectionUi} variant="compact" />
      Workspace {repository.records.collection}
    </main>
  );
}

it("adds starter views when the shared switcher's Add a collection approves one", async () => {
  starterViews.mockClear();
  const mdbase = await testMdbase();
  const [a, b] = [collectionId(mdbase, 0), collectionId(mdbase, 1)];
  render(
    <StrictMode>
      <TaskNotesApp mdbase={mdbase} Workspace={SwitcherWorkspace as never} />
    </StrictMode>,
  );
  expect(await screen.findByText(`Workspace ${a}`)).toBeVisible();

  // The switcher calls the SDK itself; TaskNotes sees only the outcome.
  approvalAdds(mdbase, b);
  fireEvent.click(screen.getByRole("button", { name: /switch collection/i }));
  fireEvent.click(await screen.findByText("Add a collection…"));
  expect(await screen.findByText(`Workspace ${b}`)).toBeVisible();
  await waitFor(() => expect(starterViews).toHaveBeenCalledOnce());
  expect(starterViews).toHaveBeenCalledWith(
    expect.objectContaining({ records: mdbase.fixture.client(b) }),
    {},
    { onlyIfNoViews: true },
  );
  expect(
    mdbase.fixture.controls.observedActions().map((call) => call.action),
  ).toContain("approve");
});

it.each(["choosing", "ready"] as const)(
  "offers one unified Add from the %s surface without a Private shortcut",
  async (phase) => {
    const mdbase = await createTestMdbase({
      phase,
      collections: [{ name: "Alpha" }, { name: "Beta" }],
    });
    const addCollection = vi.fn(
      (options: Parameters<TestMdbase["addCollection"]>[0]) =>
        mdbase.addCollection(options),
    );
    const addPrivateCollection = vi.fn(mdbase.addPrivateCollection);
    render(
      <TaskNotesApp
        mdbase={{ ...mdbase, addCollection, addPrivateCollection }}
        Workspace={SwitcherWorkspace as never}
      />,
    );
    if (phase === "ready") {
      fireEvent.click(
        await screen.findByRole("button", { name: /switch collection/i }),
      );
    }
    // jsdom's native-popover stub leaves the dialog role-hidden; query its
    // actual mounted content, as the existing switcher approval test does.
    const add = await screen.findAllByText("Add a collection…");
    expect(add).toHaveLength(1);
    expect(add[0]!.tagName).toBe("BUTTON");
    expect(screen.queryByText("Add a Private collection")).toBeNull();
    fireEvent.click(add[0]!);
    // The original SDK facade is invoked inside the click, with cancellation.
    expect(addCollection).toHaveBeenCalledExactlyOnceWith({
      signal: expect.any(AbortSignal),
    });
    await waitFor(() =>
      expect(
        mdbase.fixture.controls
          .observedActions()
          .filter((call) => call.action === "approve"),
      ).toHaveLength(1),
    );
    // The public fixture normalizes approve(null) to an omitted target.
    expect(
      mdbase.fixture.controls
        .observedActions()
        .find((call) => call.action === "approve")?.collectionId,
    ).toBeUndefined();
    expect(addPrivateCollection).not.toHaveBeenCalled();
  },
);

it("shows changed setup for renewed consent, never deletion copy or an automatic second apply", async () => {
  const mdbase = await createTestMdbase({ phase: "needs_setup" });
  const reviewed = (digest: string, message: string): MdbaseSetupPlan => ({
    status: "setup",
    canApply: true,
    digest,
    summary: "This app will make 1 change to this collection.",
    changes: [{ kind: "create", target: "_types/task.md", message }],
    conflicts: [],
    adoptable: {},
    packs: [],
    staged: [],
    records: [],
  });
  mdbase.fixture.controls.setSetupPlan(
    reviewed(`sha256:${"ab".repeat(32)}`, "Add the original note type."),
  );
  render(<TaskNotesApp mdbase={mdbase} Workspace={Workspace as never} />);
  expect(await screen.findByText("Add the original note type.")).toBeVisible();
  mdbase.fixture.controls.setSetupPlan(
    reviewed(`sha256:${"cd".repeat(32)}`, "Add the newly reviewed note type."),
  );
  mdbase.fixture.fail({ action: "applySetup", reason: "setup_changed" });
  fireEvent.click(screen.getByRole("button", { name: /^Set up$/ }));
  expect(
    await screen.findByText("Add the newly reviewed note type."),
  ).toBeVisible();
  expect(screen.getByText("This collection changed")).toBeVisible();
  expect(screen.queryByText(/not found|deleted on another device/i)).toBeNull();
  expect(
    mdbase.fixture.controls
      .observedActions()
      .filter((call) => call.action === "applySetup"),
  ).toHaveLength(1);
  expect(screen.queryByText(/^Workspace /)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Set up$/ }));
  expect(
    await screen.findByText(`Workspace ${collectionId(mdbase, 0)}`),
  ).toBeVisible();
  expect(
    mdbase.fixture.controls
      .observedActions()
      .filter((call) => call.action === "applySetup"),
  ).toHaveLength(2);
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

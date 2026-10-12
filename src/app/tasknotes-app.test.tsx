import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { expect, it, vi } from "vitest";
import type { Mdbase } from "@mdbase-dev/sdk";

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

type Snapshot = ReturnType<Mdbase["getSnapshot"]>;

function connection(id: string) {
  return {
    id,
    displayName: id,
    generation: `${id}-1`,
    records: { id },
    scope: { account: "account" },
    people: {},
    isCurrent: () => true,
  };
}
const collections = ["a", "b"].map((id) => ({
  collectionId: id,
  displayName: id === "a" ? "Alpha" : "Beta",
  role: "owner",
}));
const ready = (id: string) => ({
  kind: "ready",
  collectionId: id,
  collection: collections.find((c) => c.collectionId === id),
  connection: connection(id),
  problem: null,
});

function fakeMdbase(phase: Record<string, unknown>) {
  let snapshot = {
    status: "ready",
    collections,
    signIn: { state: "paired", accountEmail: "me@example.com" },
    selection: {
      state: "usable",
      lastApproval: null,
      requested: { collectionId: null, displayName: null },
    },
    readiness: {},
    links: null,
    phase,
  } as unknown as Snapshot;
  const listeners = new Set<() => void>();
  const mdbase = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: vi.fn(async () => snapshot),
    close: vi.fn(async () => undefined),
    signOut: vi.fn(async () => snapshot),
  };
  const set = (next: Record<string, unknown>, lastApproval: unknown = null) =>
    act(() => {
      snapshot = {
        ...snapshot,
        phase: next,
        selection: { ...snapshot.selection, lastApproval },
      } as unknown as Snapshot;
      listeners.forEach((listener) => listener());
    });
  return { mdbase, set };
}

function Workspace({
  repository,
}: {
  repository: { records: { id: string } };
}) {
  return <main>Workspace {repository.records.id}</main>;
}

it("adds starter views to the collection an approval opened, not on opening", async () => {
  starterViews.mockClear();
  const { mdbase, set } = fakeMdbase(ready("a"));
  render(
    <StrictMode>
      <TaskNotesApp
        mdbase={mdbase as unknown as Mdbase}
        Workspace={Workspace as never}
      />
    </StrictMode>,
  );
  expect(await screen.findByText("Workspace a")).toBeVisible();

  set({ kind: "authorizing", purpose: "add", collectionId: null });
  expect(
    screen.getByRole("heading", { name: "Continue in the mdbase window" }),
  ).toBeVisible();
  set(ready("b"), { kind: "add", outcome: "added", collectionId: "b" });
  expect(await screen.findByText("Workspace b")).toBeVisible();
  await waitFor(() => expect(starterViews).toHaveBeenCalledOnce());
  expect(starterViews).toHaveBeenCalledWith(
    expect.objectContaining({ records: { id: "b" } }),
    {},
    { onlyIfNoViews: true },
  );

  // Switching back is navigation: nothing is written.
  set(ready("a"), { kind: "add", outcome: "added", collectionId: "b" });
  expect(await screen.findByText("Workspace a")).toBeVisible();
  expect(starterViews).toHaveBeenCalledOnce();
});

it("signs out through the SDK and never just closes the entry", async () => {
  const { mdbase } = fakeMdbase({ kind: "choosing", lastApproval: null });
  window.history.replaceState(null, "", "/?demo=50");
  render(<TaskNotesApp mdbase={mdbase as unknown as Mdbase} />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(mdbase.signOut).toHaveBeenCalledOnce());
  expect(mdbase.close).not.toHaveBeenCalled();
});

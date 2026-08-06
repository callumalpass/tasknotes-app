import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const connect = vi.hoisted(() => {
  const connections = [
    {
      collectionId: "collection-offline",
      displayName: "Home tasks",
      operations: [],
      scope: { contracts: [], access: "full_collection" },
      route: "relay",
      directAccess: "unavailable",
    },
    {
      collectionId: "collection-online",
      displayName: "Work tasks",
      operations: [],
      scope: { contracts: [], access: "full_collection" },
      route: "remote",
      directAccess: "disabled",
    },
  ];
  const listeners = new Set<() => void>();
  const state = {
    snapshot: {
      status: "unavailable",
      collectionId: "collection-stale",
      reason: "not_authorized",
      connections,
    } as Record<string, unknown>,
  };
  const select = vi.fn((collectionId: string) => {
    history.replaceState(null, "", `/?collection=${collectionId}`);
    state.snapshot = {
      status: "ready",
      collectionId,
      connection: { collectionId },
      info: connections.find(
        (connection) => connection.collectionId === collectionId,
      ),
      access: {
        authorized: true,
        sufficient: true,
        collectionId,
        grantedOperations: [],
        missingOperations: [],
      },
      connections,
    };
    for (const listener of listeners) listener();
  });
  return {
    applyCollectionSetup: vi.fn(() =>
      Promise.resolve({ ok: true, value: state.snapshot }),
    ),
    authorize: vi.fn(() => Promise.resolve({ kind: "redirecting" })),
    getSnapshot: () => state.snapshot,
    reset: () => {
      state.snapshot = {
        status: "unavailable",
        collectionId: "collection-stale",
        reason: "not_authorized",
        connections,
      };
    },
    setSnapshot: (snapshot: Record<string, unknown>) => {
      state.snapshot = snapshot;
    },
    select,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock("../cloud/connect", () => ({
  cloudSession: connect,
}));

import { CloudConnection } from "./cloud-collection";

beforeEach(() => {
  history.replaceState(null, "", "/?collection=collection-stale");
  connect.reset();
  connect.authorize.mockClear();
  connect.applyCollectionSetup.mockClear();
  connect.select.mockClear();
});

it("shows and applies the exact reviewed collection setup", async () => {
  connect.setSnapshot({
    status: "setup_review_required",
    collectionId: "collection-online",
    connections: [],
    info: connect.getSnapshot(),
    capabilities: {},
    update: {
      status: "provision",
      applicable: true,
      canApply: true,
      configuration: [
        {
          requirement: "tasknotes-base-sources",
          path: "/x-obsidian/bases/include",
          value: "TaskNotes/Views/**/*.base",
          action: "add",
        },
      ],
      typePacks: [],
    },
  });

  render(<CloudConnection error={null} />);

  expect(screen.getByText("Review TaskNotes setup")).toBeVisible();
  expect(screen.getByText(/TaskNotes\/Views\/\*\*\/\*\.base/)).toBeVisible();
  expect(connect.applyCollectionSetup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply reviewed setup" }));
  await waitFor(() =>
    expect(connect.applyCollectionSetup).toHaveBeenCalledWith({
      timeoutMs: 60_000,
    }),
  );
});

it("explains a setup conflict without mutating the collection", () => {
  connect.setSnapshot({
    status: "setup_review_required",
    collectionId: "collection-online",
    connections: [],
    info: connect.getSnapshot(),
    capabilities: {},
    update: {
      status: "conflict",
      applicable: false,
      canApply: false,
      configuration: [
        {
          requirement: "tasknotes-base-sources",
          path: "/x-obsidian/bases/include",
          value: "TaskNotes/Views/**/*.base",
          action: "conflict",
          conflict: {
            message:
              "Base source includes must be a list, but this collection uses text.",
          },
        },
      ],
      typePacks: [],
    },
  });

  render(<CloudConnection error={null} />);

  expect(
    screen.getByText(
      "Base source includes must be a list, but this collection uses text.",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Apply reviewed setup" }),
  ).toBeDisabled();
  expect(connect.applyCollectionSetup).not.toHaveBeenCalled();
});

it("switches from a stale bookmark to a remembered collection without reloading", () => {
  render(<CloudConnection error={null} />);

  fireEvent.click(screen.getByRole("button", { name: "Open Work tasks" }));

  expect(connect.select).toHaveBeenCalledWith("collection-online", {
    history: "replace",
  });
  expect(new URL(location.href).searchParams.get("collection")).toBe(
    "collection-online",
  );
});

it("lists remembered collections and authorizes another with choose intent", () => {
  render(<CloudConnection error={null} />);

  expect(screen.getByRole("button", { name: "Open Home tasks" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Open Work tasks" })).toBeVisible();
  expect(
    screen.getByText("Connect to a computer").parentElement,
  ).toHaveTextContent("computer is reachable");

  fireEvent.click(
    screen.getByRole("button", { name: "Connect another collection" }),
  );

  expect(connect.authorize).toHaveBeenCalledWith("choose", {
    timeoutMs: 60_000,
  });
});

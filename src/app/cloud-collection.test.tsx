import { fireEvent, render, screen } from "@testing-library/react";

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
  connect.select.mockClear();
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

  expect(connect.authorize).toHaveBeenCalledWith("choose");
});

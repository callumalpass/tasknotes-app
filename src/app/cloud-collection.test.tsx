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
    connection: null as null | {
      collectionId: string;
      pendingMutations(): Array<{
        recover: ReturnType<typeof vi.fn>;
        requestId: string;
      }>;
    },
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
    return { ok: true, value: { collectionId } };
  });
  return {
    applyCollectionSetup: vi.fn(() =>
      Promise.resolve({ ok: true, value: state.snapshot }),
    ),
    authorize: vi.fn(() =>
      Promise.resolve({ ok: true, value: { kind: "redirecting" } }),
    ),
    connection: () => state.connection,
    forget: vi.fn(() => ({ ok: true, value: undefined })),
    getSnapshot: () => state.snapshot,
    reset: () => {
      state.connection = null;
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
    setConnection: (connection: typeof state.connection) => {
      state.connection = connection;
    },
    select,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

const recoveryStorage = vi.hoisted(() => ({
  pendingRecoveryRequestIds: vi.fn(() => Promise.resolve(new Set<string>())),
  removePendingRecoveryCommands: vi.fn(() => Promise.resolve()),
}));

vi.mock("../cloud/connect", () => ({
  cloudSession: connect,
  startCloudSession: vi.fn(() => Promise.resolve()),
}));
vi.mock("../storage/application-journal", () => recoveryStorage);
vi.mock("./opened-collection", () => ({
  OpenedCollection: () => <div>Opened collection</div>,
}));

import CloudCollection, { CloudConnection } from "./cloud-collection";

beforeEach(() => {
  history.replaceState(null, "", "/?collection=collection-stale");
  connect.reset();
  connect.authorize.mockClear();
  connect.applyCollectionSetup.mockClear();
  connect.forget.mockClear();
  connect.select.mockClear();
  recoveryStorage.pendingRecoveryRequestIds.mockReset();
  recoveryStorage.pendingRecoveryRequestIds.mockResolvedValue(new Set());
  recoveryStorage.removePendingRecoveryCommands.mockClear();
});

it("opens the disposable demo without contacting mdbase", () => {
  const onTryDemo = vi.fn();

  render(<CloudConnection error={null} onTryDemo={onTryDemo} />);

  fireEvent.click(screen.getByRole("button", { name: "Try demo" }));

  expect(onTryDemo).toHaveBeenCalledOnce();
  expect(connect.authorize).not.toHaveBeenCalled();
});

it("offers an explicit retry after session startup fails", () => {
  connect.setSnapshot({
    status: "start_failed",
    connections: [],
    problem: {
      code: "temporarily_unavailable",
      message: "Mdbase is temporarily unavailable.",
    },
  });
  const retryStartup = vi.fn();

  render(
    <CloudCollection
      authorizationError={null}
      authorizeAnotherCollection={vi.fn()}
      callbackRetryAvailable={false}
      ensureStarted={() => Promise.resolve()}
      openCollectionPicker={vi.fn()}
      reauthorizeCurrentCollection={vi.fn()}
      retryStartup={retryStartup}
    />,
  );

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Mdbase is temporarily unavailable.",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Retry opening TaskNotes" }),
  );
  expect(retryStartup).toHaveBeenCalledOnce();
});

it("shows a retry when startup cancellation returns to not started", () => {
  connect.setSnapshot({ status: "not_started", connections: [] });
  const retryStartup = vi.fn();

  render(
    <CloudCollection
      authorizationError="Application session startup was cancelled."
      authorizeAnotherCollection={vi.fn()}
      callbackRetryAvailable={false}
      ensureStarted={() => Promise.resolve()}
      openCollectionPicker={vi.fn()}
      reauthorizeCurrentCollection={vi.fn()}
      retryStartup={retryStartup}
    />,
  );

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Application session startup was cancelled.",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Retry opening TaskNotes" }),
  );
  expect(retryStartup).toHaveBeenCalledOnce();
});

it("recovers restart-time pending mutations only after confirmation", async () => {
  const recover = vi.fn(() => Promise.resolve({ ok: true, value: {} }));
  connect.setConnection({
    collectionId: "collection-online",
    pendingMutations: () => [{ recover, requestId: "request-recover" }],
  });
  connect.setSnapshot({
    status: "ready",
    verification: "verified",
    collectionId: "collection-online",
    connections: [],
    capabilities: {},
    info: {},
  });

  render(
    <CloudCollection
      authorizationError={null}
      authorizeAnotherCollection={vi.fn()}
      callbackRetryAvailable={false}
      ensureStarted={() => Promise.resolve()}
      openCollectionPicker={vi.fn()}
      reauthorizeCurrentCollection={vi.fn()}
      retryStartup={vi.fn()}
    />,
  );

  expect(
    await screen.findByRole("heading", { name: "Review unconfirmed changes" }),
  ).toBeVisible();
  expect(screen.getByText(/will not replay it automatically/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Recover saved changes" }),
  ).toBeVisible();
  expect(recover).not.toHaveBeenCalled();

  fireEvent.click(
    screen.getByRole("button", { name: "Recover saved changes" }),
  );
  expect(recover).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm recovery" }));

  await waitFor(() =>
    expect(recover).toHaveBeenCalledWith({ timeoutMs: 60_000 }),
  );
});

it("discards generic pending handles through confirmed session forget", async () => {
  connect.setConnection({
    collectionId: "collection-online",
    pendingMutations: () => [
      { recover: vi.fn(), requestId: "request-discard" },
    ],
  });
  connect.setSnapshot({
    status: "ready",
    verification: "verified",
    collectionId: "collection-online",
    connections: [],
    capabilities: {},
    info: {},
  });

  render(
    <CloudCollection
      authorizationError={null}
      authorizeAnotherCollection={vi.fn()}
      callbackRetryAvailable={false}
      ensureStarted={() => Promise.resolve()}
      openCollectionPicker={vi.fn()}
      reauthorizeCurrentCollection={vi.fn()}
      retryStartup={vi.fn()}
    />,
  );

  fireEvent.click(
    await screen.findByRole("button", {
      name: "Discard recovery and disconnect",
    }),
  );
  expect(connect.forget).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm discard and disconnect" }),
  );
  expect(recoveryStorage.removePendingRecoveryCommands).toHaveBeenCalledWith(
    "collection-online",
  );
  expect(connect.forget).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(connect.forget).toHaveBeenCalledWith("collection-online"),
  );
});

it("does not forget SDK recovery when durable journal cleanup fails", async () => {
  recoveryStorage.removePendingRecoveryCommands.mockRejectedValueOnce(
    new Error("Journal cleanup failed."),
  );
  connect.setConnection({
    collectionId: "collection-online",
    pendingMutations: () => [
      { recover: vi.fn(), requestId: "request-discard" },
    ],
  });
  connect.setSnapshot({
    status: "ready",
    verification: "verified",
    collectionId: "collection-online",
    connections: [],
    capabilities: {},
    info: {},
  });

  render(
    <CloudCollection
      authorizationError={null}
      authorizeAnotherCollection={vi.fn()}
      callbackRetryAvailable={false}
      ensureStarted={() => Promise.resolve()}
      openCollectionPicker={vi.fn()}
      reauthorizeCurrentCollection={vi.fn()}
      retryStartup={vi.fn()}
    />,
  );

  fireEvent.click(
    await screen.findByRole("button", {
      name: "Discard recovery and disconnect",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm discard and disconnect" }),
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Journal cleanup failed.",
  );
  expect(connect.forget).not.toHaveBeenCalled();
});

it("leaves journal-mapped handles for exact in-app recovery", async () => {
  const recover = vi.fn();
  recoveryStorage.pendingRecoveryRequestIds.mockResolvedValue(
    new Set(["request-delete"]),
  );
  connect.setConnection({
    collectionId: "collection-online",
    pendingMutations: () => [{ recover, requestId: "request-delete" }],
  });
  connect.setSnapshot({
    status: "ready",
    verification: "verified",
    collectionId: "collection-online",
    connections: [],
    capabilities: {},
    info: {},
  });

  render(
    <CloudCollection
      authorizationError={null}
      authorizeAnotherCollection={vi.fn()}
      callbackRetryAvailable={false}
      ensureStarted={() => Promise.resolve()}
      openCollectionPicker={vi.fn()}
      reauthorizeCurrentCollection={vi.fn()}
      retryStartup={vi.fn()}
    />,
  );

  expect(await screen.findByText("Opened collection")).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Review unconfirmed changes" }),
  ).not.toBeInTheDocument();
  expect(recover).not.toHaveBeenCalled();
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
  expect(
    screen.queryByRole("button", { name: /Reconnect/ }),
  ).not.toBeInTheDocument();
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

it("switches from a stale bookmark to a remembered collection without reloading", async () => {
  render(<CloudConnection error={null} />);

  fireEvent.click(screen.getByRole("button", { name: "Open Work tasks" }));

  await waitFor(() =>
    expect(connect.select).toHaveBeenCalledWith("collection-online", {
      history: "replace",
    }),
  );
  expect(new URL(location.href).searchParams.get("collection")).toBe(
    "collection-online",
  );
});

it("lists remembered collections and authorizes another with choose intent", async () => {
  render(<CloudConnection error={null} />);

  expect(screen.getByRole("button", { name: "Open Home tasks" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Open Work tasks" })).toBeVisible();

  fireEvent.click(
    screen.getByRole("button", { name: "Connect another collection" }),
  );

  await waitFor(() =>
    expect(connect.authorize).toHaveBeenCalledWith("choose", {
      timeoutMs: 60_000,
    }),
  );
});

it("reviews declaration changes explicitly without offering the unusable selection", async () => {
  connect.setSnapshot({
    status: "authorization_required",
    collectionId: "collection-online",
    connections: connect.getSnapshot().connections,
    info: {},
    capabilities: {},
  });

  render(<CloudConnection error={null} />);

  expect(
    screen.getByRole("heading", { name: "Review updated access" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Open Work tasks" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open Home tasks" })).toBeVisible();

  fireEvent.click(
    screen.getByRole("button", { name: "Review updated access" }),
  );
  await waitFor(() =>
    expect(connect.authorize).toHaveBeenCalledWith("selected", {
      timeoutMs: 60_000,
    }),
  );
});

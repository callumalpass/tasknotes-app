import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const native = vi.hoisted(() => ({
  callbackUrl: null as string | null,
  close: vi.fn(() => Promise.resolve()),
}));

const connect = vi.hoisted(() => {
  const snapshot = { status: "unselected", connections: [] } as const;
  const session = {
    authorize: vi.fn(() =>
      Promise.resolve({ ok: true, value: { kind: "redirecting" } }),
    ),
    connection: vi.fn(() => null),
    getSnapshot: vi.fn(() => snapshot),
    handleAuthorizationCallback: vi.fn(() =>
      Promise.resolve({
        ok: true,
        value: { collectionId: "connected" },
      }),
    ),
    select: vi.fn(() => ({ ok: true, value: undefined })),
    start: vi.fn((options?: unknown) => {
      void options;
      return Promise.resolve({ ok: true, value: snapshot });
    }),
    subscribe: vi.fn(() => () => undefined),
  };
  return {
    ...session,
    startCloudSession: vi.fn(async (options) => {
      await session.start(options);
    }),
  };
});

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: vi.fn(() => "web"),
    isNativePlatform: vi.fn(() => true),
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(
      (_event: string, listener: (event: { url: string }) => void) => {
        if (native.callbackUrl)
          queueMicrotask(() => listener({ url: native.callbackUrl! }));
        return Promise.resolve({ remove: vi.fn() });
      },
    ),
    getLaunchUrl: vi.fn(() =>
      Promise.resolve(
        native.callbackUrl ? { url: native.callbackUrl } : undefined,
      ),
    ),
  },
}));

vi.mock("@capacitor/browser", () => ({
  Browser: {
    close: native.close,
    open: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("../cloud/connect", () => ({
  cloudSession: connect,
  startCloudSession: connect.startCloudSession,
  isCloudCallback: (value: string) => {
    const url = new URL(value);
    return url.searchParams.has("state") && url.searchParams.has("code");
  },
  isHostedCloudConnection: () => false,
}));

import { Capacitor } from "@capacitor/core";

import { CollectionGate } from "./collection-gate";

beforeEach(() => {
  history.replaceState(null, "", "/");
  native.callbackUrl = null;
  native.close.mockClear();
  connect.handleAuthorizationCallback.mockClear();
  connect.handleAuthorizationCallback.mockResolvedValue({
    ok: true,
    value: { collectionId: "connected" },
  });
  connect.start.mockClear();
  connect.startCloudSession.mockClear();
  connect.startCloudSession.mockImplementation(async (options) => {
    await connect.start(options);
  });
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
});

afterEach(() => vi.restoreAllMocks());

it("offers mdbase without a device-folder storage path", async () => {
  render(<CollectionGate />);

  expect(
    await screen.findByRole("heading", { name: "Open TaskNotes" }),
  ).toBeVisible();
  expect(screen.queryByText(/folder for your tasks/i)).not.toBeInTheDocument();
  expect(connect.start).toHaveBeenCalledWith(
    expect.objectContaining({
      signal: expect.anything(),
      timeoutMs: 60_000,
    }),
  );
});

it("queues a native callback until explicit startup succeeds", async () => {
  let finishStartup!: () => void;
  connect.startCloudSession.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishStartup = resolve;
      }),
  );
  native.callbackUrl =
    "dev.tasknotes.app://auth/mdbase/callback?code=approved&state=queued";

  render(<CollectionGate />);
  await waitFor(() => expect(connect.startCloudSession).toHaveBeenCalled());
  expect(connect.handleAuthorizationCallback).not.toHaveBeenCalled();

  finishStartup();

  await waitFor(() =>
    expect(connect.handleAuthorizationCallback).toHaveBeenCalledTimes(1),
  );
});

it("deduplicates a native callback delivered as launch and open events", async () => {
  const callback =
    "dev.tasknotes.app://auth/mdbase/callback?code=approved&state=session";
  native.callbackUrl = callback;

  render(<CollectionGate />);

  await waitFor(() =>
    expect(connect.handleAuthorizationCallback).toHaveBeenCalledTimes(1),
  );
  await waitFor(() => expect(native.close).toHaveBeenCalledTimes(1));
  expect(connect.handleAuthorizationCallback).toHaveBeenCalledWith(
    callback,
    expect.objectContaining({
      signal: expect.anything(),
      timeoutMs: 60_000,
    }),
  );
});

it("retains a failed callback and marks it handled only after retry succeeds", async () => {
  const callback =
    "dev.tasknotes.app://auth/mdbase/callback?code=approved&state=retryable";
  native.callbackUrl = callback;
  connect.handleAuthorizationCallback.mockResolvedValueOnce({
    ok: false,
    problem: {
      code: "temporarily_unavailable",
      message: "Try callback again.",
    },
  } as never);

  render(<CollectionGate />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Try callback again.",
  );
  expect(connect.handleAuthorizationCallback).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Retry authorization" }));

  await waitFor(() =>
    expect(connect.handleAuthorizationCallback).toHaveBeenCalledTimes(2),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Retry authorization" }),
    ).not.toBeInTheDocument(),
  );
});

it("completes a web callback without closing a native browser", async () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  history.replaceState(
    null,
    "",
    "/auth/mdbase/callback?code=approved&state=web-session",
  );

  render(<CollectionGate />);

  await waitFor(() =>
    expect(connect.handleAuthorizationCallback).toHaveBeenCalledTimes(1),
  );
  expect(native.close).not.toHaveBeenCalled();
});

it("preserves a web callback before startup so retry replays its exact URL", async () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  const callback = `${location.origin}/auth/mdbase/callback?code=approved&state=preserved`;
  history.replaceState(null, "", callback);
  connect.startCloudSession.mockImplementationOnce(async () => {
    history.replaceState(null, "", "/");
    throw new Error("Startup failed before callback handling.");
  });

  render(<CollectionGate />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Startup failed before callback handling.",
  );
  expect(connect.handleAuthorizationCallback).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Retry authorization" }));

  await waitFor(() =>
    expect(connect.handleAuthorizationCallback).toHaveBeenCalledWith(
      callback,
      expect.objectContaining({ timeoutMs: 60_000 }),
    ),
  );
});

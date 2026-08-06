import { render, screen, waitFor } from "@testing-library/react";

const native = vi.hoisted(() => ({
  callbackUrl: null as string | null,
  close: vi.fn(() => Promise.resolve()),
}));

const connect = vi.hoisted(() => {
  const snapshot = { status: "unselected", connections: [] } as const;
  return {
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
    start: vi.fn(() => Promise.resolve({ ok: true, value: snapshot })),
    subscribe: vi.fn(() => () => undefined),
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
  connect.start.mockClear();
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

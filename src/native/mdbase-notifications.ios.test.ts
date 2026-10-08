import { afterEach, beforeEach, expect, it, vi } from "vitest";

const connect = vi.hoisted(() => ({
  registerNativeNotifications: vi.fn(async () => ({ ok: true, value: {} })),
  unregisterNativeNotifications: vi.fn(async () => ({
    ok: true,
    value: undefined,
  })),
}));

vi.mock("../cloud/connect", () => ({
  cloudSession: {
    getSnapshot: () => ({
      status: "ready",
      capabilities: {
        values: { "background.schedule": { state: "available" } },
      },
    }),
    connection: () => ({
      info: () => ({ collectionId: "collection" }),
      ...connect,
    }),
  },
}));

let permission = "prompt";
const listeners = new Map<string, (event: unknown) => void>();
const nativePromise = vi.fn(async (_plugin: string, method: string) => {
  if (method === "checkPermissions") return { receive: permission };
  if (method === "requestPermissions") {
    permission = "granted";
    return { receive: permission };
  }
  if (method === "getToken") return { token: "fcm-token" };
});
const nativeCallback = vi.fn(
  (
    _plugin: string,
    _method: string,
    options: { eventName: string },
    listener: (event: unknown) => void,
  ) => {
    listeners.set(options.eventName, listener);
    return options.eventName;
  },
);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  listeners.clear();
  permission = "prompt";
  // Exercise the real Capacitor registerPlugin proxy, not a plain messaging mock.
  vi.stubGlobal("webkit", { messageHandlers: { bridge: {} } });
  vi.stubGlobal("Capacitor", {
    PluginHeaders: [
      {
        name: "FirebaseMessaging",
        methods: [
          ...[
            "checkPermissions",
            "requestPermissions",
            "getToken",
            "deleteToken",
            "createChannel",
            "removeListener",
          ].map((name) => ({ name, rtype: "promise" })),
          { name: "addListener", rtype: "callback" },
        ],
      },
    ],
    nativePromise,
    nativeCallback,
  });
});

afterEach(() => vi.unstubAllGlobals());

it("loads the real iOS proxy without assimilating it as a thenable", async () => {
  const { mdbaseNotifications } = await import("./mdbase-notifications");
  expect(await mdbaseNotifications.status()).toEqual({
    state: "off",
    optedIn: false,
  });
  expect(nativePromise).toHaveBeenCalledWith(
    "FirebaseMessaging",
    "checkPermissions",
    undefined,
  );
  expect(
    nativePromise.mock.calls.some(
      ([, method]) => method === "requestPermissions",
    ),
  ).toBe(false);

  expect(await mdbaseNotifications.enable()).toEqual({
    state: "enabled",
    optedIn: true,
  });
  expect(connect.registerNativeNotifications).toHaveBeenCalledWith({
    token: "fcm-token",
    timeoutMs: 45_000,
  });
  await mdbaseNotifications.refreshRegistration();
  expect(connect.registerNativeNotifications).toHaveBeenCalledTimes(2);

  expect(await mdbaseNotifications.disable()).toEqual({
    state: "off",
    optedIn: false,
  });
  expect(nativePromise.mock.calls.map(([, method]) => method)).toContain(
    "deleteToken",
  );
  expect(nativePromise.mock.calls.map(([, method]) => method)).not.toContain(
    "then",
  );
});

it("attaches and removes all iOS listeners through the real proxy", async () => {
  const { mdbaseNotifications } = await import("./mdbase-notifications");
  const wake = vi.fn();
  const dispose = mdbaseNotifications.listen(wake);
  await vi.waitFor(() => expect(listeners.size).toBe(3));
  listeners.get("notificationReceived")!({
    notification: {
      data: {
        type: "mdbase.notification",
        version: 1,
        signal_id: "signal",
        criterion_id: "task.reminder",
        cursor: "42",
      },
    },
  });
  expect(wake).toHaveBeenCalledWith({
    opened: false,
    notification: expect.objectContaining({ signal_id: "signal" }),
  });
  await mdbaseNotifications.enable();
  listeners.get("tokenReceived")!({ token: "rotated-token" });
  await vi.waitFor(() =>
    expect(connect.registerNativeNotifications).toHaveBeenCalledWith({
      token: "rotated-token",
      timeoutMs: 45_000,
    }),
  );
  dispose();
  await vi.waitFor(() =>
    expect(
      nativePromise.mock.calls.filter(
        ([, method]) => method === "removeListener",
      ),
    ).toHaveLength(3),
  );
});

import { TimersApi, type AppTimersPort } from "@mdbase-dev/sdk";
import { expect, it, vi } from "vitest";
import { MdbaseNotificationManager } from "./mdbase-notifications";
import type { NativeMessaging } from "./android-push-messaging";

// Exercise the actual pinned SDK single-flight proxy, not a permissive timer
// mock. This internal module is deliberately located from the installed pin;
// no new SDK export/API is required. The peer below is only an ACK stand-in.
const timerPortUrl = new URL(
  "./app-host/timer-port.js",
  import.meta.resolve("@mdbase-dev/sdk"),
).href;
const { appTimerPortClient } = (await import(
  /* @vite-ignore */ timerPortUrl
)) as {
  appTimerPortClient(
    port: MessagePort,
    binding: {
      scope: { account: string; installation: string; collection: string };
      generation: string;
    },
    options: { signal: AbortSignal; onClose(): void },
  ): AppTimersPort;
};

it.each(["enable", "refresh", "rotate", "disable"] as const)(
  "drains the admitted reconcile ACK before %s on the same SDK port",
  async (operation) => {
    const f = fixture();
    try {
      f.manager.listen(vi.fn());
      await f.manager.enable();
      await f.startReconcile();
      const before = f.channelRequests();
      let settled = false;
      const transition =
        operation === "rotate"
          ? (f.rotate(), Promise.resolve())
          : operation === "disable"
            ? f.manager.disable()
            : operation === "refresh"
              ? f.manager.refreshRegistration()
              : f.manager.enable();
      void transition.then(() => {
        settled = true;
      });
      await vi.waitFor(() => expect(f.scheduling()).toBe(false));
      expect(f.channelRequests()).toBe(before);
      if (operation !== "rotate") expect(settled).toBe(false);
      expect(f.reconcileSignal()?.aborted).toBe(false);
      f.ackReconcile();
      await transition;
      await vi.waitFor(() => expect(f.channelRequests()).toBe(before + 1));
      await vi.waitFor(async () =>
        expect(await f.manager.status()).toEqual({
          state: operation === "disable" ? "off" : "enabled",
          optedIn: operation !== "disable",
        }),
      );
      expect(f.storage.getItem("tasknotes:mdbase-notifications:v2:scope")).toBe(
        operation === "disable" ? null : "1",
      );
    } finally {
      f.close();
    }
  },
);

it.each(["1", null])(
  "restores prior consent %s on actual SDK timer_port_busy without retrying",
  async (previous) => {
    const f = fixture(false);
    try {
      await f.manager.enable();
      await f.startReconcile();
      if (!previous)
        f.storage.removeItem("tasknotes:mdbase-notifications:v2:scope");
      // Demonstrate why an immediate/aborting false callback is insufficient:
      // the SDK still owns the admitted slot until its peer's ACK arrives.
      await expect(f.manager.enable()).rejects.toMatchObject({
        code: "unavailable",
        reason: "timer_port_busy",
      });
      expect(f.storage.getItem("tasknotes:mdbase-notifications:v2:scope")).toBe(
        previous,
      );
      expect(f.channelRequests()).toBe(1);
      f.ackReconcile();
      await f.drained();
      expect(f.channelRequests()).toBe(1);
      // Retry is explicit, not triggered by the refusal itself.
      await f.manager.enable();
      expect(f.channelRequests()).toBe(2);
    } finally {
      f.close();
    }
  },
);

it("does not register a stale binding after its false callback drains", async () => {
  const f = fixture();
  try {
    await f.manager.enable();
    await f.startReconcile();
    const refreshing = f.manager.refreshRegistration();
    const rejected = expect(refreshing).rejects.toThrow("scope changed");
    await vi.waitFor(() => expect(f.scheduling()).toBe(false));
    f.manager.bindScope({ key: "new-scope", timers: f.timers });
    f.ackReconcile();
    await rejected;
    expect(f.channelRequests()).toBe(1);
    expect(await f.manager.status()).toEqual({ state: "off", optedIn: false });
  } finally {
    f.close();
  }
});

function fixture(drain = true) {
  const storage = localStorage;
  storage.clear();
  const channel = new MessageChannel();
  const lifetime = new AbortController();
  const port = appTimerPortClient(
    channel.port1,
    {
      scope: {
        account: "account",
        installation: "installation",
        collection: "collection",
      },
      generation: "generation",
    },
    { signal: lifetime.signal, onClose() {} },
  );
  const timers = new TimersApi(port);
  const frames: unknown[][] = [];
  let held: unknown[] | undefined;
  const reply = (frame: unknown[], result: unknown) => {
    channel.port2.postMessage([1, frame[1], frame[2], frame[3], true, result]);
  };
  channel.port2.addEventListener(
    "message",
    ({ data }: MessageEvent<unknown[]>) => {
      if (data.length !== 6) return;
      frames.push(data);
      if (data[4] === "reconcile") held = data;
      else
        reply(
          data,
          data[4] === "registerChannel"
            ? {
                channelId: "channel",
                installationId: "installation",
                criteria: ["task.reminder"],
              }
            : undefined,
        );
    },
  );
  channel.port2.start();
  let tokenListener: ((event: { token: string }) => void) | undefined;
  const messaging = {
    checkPermissions: async () => ({ receive: "granted" }),
    requestPermissions: vi.fn(async () => ({ receive: "granted" })),
    getToken: async () => ({ token: "shared-fcm-token" }),
    deleteToken: vi.fn(async () => undefined),
    createChannel: async () => undefined,
    addListener: async (
      event: string,
      listener: (event: { token: string }) => void,
    ) => {
      if (event === "tokenReceived") tokenListener = listener;
      return { remove: async () => undefined };
    },
  };
  let scheduling = false;
  let active = Promise.resolve();
  let reconcileSignal: AbortSignal | undefined;
  const manager = new MdbaseNotificationManager({
    messaging: messaging as unknown as NativeMessaging,
    webPush: {
      isSupported: () => false,
      checkPermissions: async () => ({ receive: "denied" }),
      requestPermissions: async () => ({ receive: "denied" }),
      serviceWorker: async () => {
        throw new Error("not web");
      },
      addListener: async () => ({ remove: async () => undefined }),
    },
    storage,
    isNative: () => true,
    isConfigured: () => true,
  });
  manager.bindScope({ key: "scope", timers }, (enabled) => {
    // Repository contract: synchronously stop admission, naturally drain the
    // original promise. Never call the manager back from this callback.
    scheduling = enabled;
    return !enabled && drain ? active : undefined;
  });
  return {
    manager,
    timers,
    storage,
    scheduling: () => scheduling,
    drained: () => active,
    reconcileSignal: () => reconcileSignal,
    channelRequests: () =>
      frames.filter((frame) => String(frame[4]).endsWith("Channel")).length,
    rotate: () => tokenListener!({ token: "rotated-shared-token" }),
    async startReconcile() {
      expect(scheduling).toBe(true);
      reconcileSignal = new AbortController().signal;
      active = timers
        .reconcile(
          {
            namespace: "task-reminders",
            criterionId: "task.reminder",
            timers: [],
          },
          { signal: reconcileSignal },
        )
        .then(() => undefined);
      await vi.waitFor(() => expect(held).toBeDefined());
    },
    ackReconcile() {
      expect(held).toBeDefined();
      reply(held!, {
        namespace: "task-reminders",
        timers: [],
        cancelled_ids: [],
      });
      held = undefined;
    },
    close() {
      manager.bindScope(null);
      timers.close();
      lifetime.abort();
      channel.port1.close();
      channel.port2.close();
    },
  };
}

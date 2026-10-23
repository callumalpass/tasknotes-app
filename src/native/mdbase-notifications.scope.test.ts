import { TimersApi, type AppTimersPort } from "@mdbase-dev/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  MdbaseNotificationManager,
  type MdbaseNotificationManagerOptions,
} from "./mdbase-notifications";
import type { NativeMessaging } from "./android-push-messaging";

const key = "tasknotes:mdbase-notifications:v2:";
const signal = {
  type: "mdbase.notification",
  version: 1,
  signal_id: "opaque",
  criterion_id: "task.reminder",
  cursor: "cursor",
};

describe("notification scope lifecycle", () => {
  it("stops scheduling when status observes lost permission or a failed permission check", async () => {
    const f = fixture();
    const changed = vi.fn();
    f.subject.bindScope({ key: "scope", timers: f.timers }, changed);
    await f.subject.enable();
    expect(changed).toHaveBeenLastCalledWith(true);
    f.permission("denied");
    expect(await f.subject.status()).toEqual({
      state: "denied",
      optedIn: true,
    });
    expect(changed).toHaveBeenLastCalledWith(false);
    f.permission("granted");
    await f.subject.refreshRegistration();
    expect(changed).toHaveBeenLastCalledWith(true);
    f.messaging.checkPermissions.mockRejectedValueOnce(
      new Error("bridge failed"),
    );
    await expect(f.subject.status()).rejects.toThrow("bridge failed");
    expect(changed).toHaveBeenLastCalledWith(false);
  });

  it("gates scheduling until restoration confirms registration and stops it before unregister", async () => {
    const f = fixture();
    f.permission("granted");
    f.storage.setItem(key + "scope", "1");
    const changed = vi.fn();
    f.subject.bindScope({ key: "scope", timers: f.timers }, changed);
    expect(changed).toHaveBeenLastCalledWith(false);
    const response = deferred<{
      channelId: string;
      installationId: string;
      criteria: string[];
      transport: "fcm";
    }>();
    f.port.registerFcm.mockReturnValueOnce(response.promise);
    const restoring = f.subject.refreshRegistration();
    await vi.waitFor(() => expect(f.port.registerFcm).toHaveBeenCalledOnce());
    expect(changed).not.toHaveBeenCalledWith(true);
    response.resolve({
      channelId: "channel",
      installationId: "installation",
      criteria: ["task.reminder"],
      transport: "fcm",
    });
    await restoring;
    expect(changed).toHaveBeenLastCalledWith(true);
    f.port.unregisterFcm.mockImplementationOnce(async () => {
      expect(changed).toHaveBeenLastCalledWith(false);
    });
    await f.subject.disable();
    expect(changed).toHaveBeenLastCalledWith(false);
  });

  it.each(["throw", "reject"])(
    "keeps a scheduling callback %s out of registration outcomes",
    async (failure) => {
      const f = fixture();
      const changed = vi.fn((enabled: boolean) => {
        if (!enabled) return;
        if (failure === "throw") throw new Error("schedule failed");
        return Promise.reject(new Error("schedule failed"));
      });
      f.subject.bindScope({ key: "scope", timers: f.timers }, changed);
      expect(await f.subject.enable()).toEqual({
        state: "enabled",
        optedIn: true,
      });
      expect(f.storage.getItem(key + "scope")).toBe("1");
      await f.subject.disable();
    },
  );

  it("does not adopt legacy consent or transfer consent to another grant", async () => {
    const f = fixture();
    f.storage.setItem("tasknotes:mdbase-notifications:v1", "1");
    await f.subject.refreshRegistration();
    expect(f.port.registerFcm).not.toHaveBeenCalled();
    await f.subject.enable();
    f.subject.bindScope({ key: "different-grant", timers: f.timers });
    expect(await f.subject.status()).toEqual({ state: "off", optedIn: false });
    await f.subject.refreshRegistration();
    expect(f.port.registerFcm).toHaveBeenCalledTimes(1);
    expect(f.messaging.requestPermissions).toHaveBeenCalledTimes(1);
  });

  it("restores only recorded scope consent without requesting permission", async () => {
    const f = fixture();
    f.permission("granted");
    f.storage.setItem(key + "scope", "1");
    await f.subject.refreshRegistration();
    expect(f.port.registerFcm).toHaveBeenCalledOnce();
    expect(f.messaging.requestPermissions).not.toHaveBeenCalled();
    f.permission("prompt");
    await f.subject.refreshRegistration();
    expect(f.port.registerFcm).toHaveBeenCalledOnce();
    expect(f.messaging.requestPermissions).not.toHaveBeenCalled();
  });

  it("leaves consent off after permission denial", async () => {
    const f = fixture();
    f.permission("denied");
    expect(await f.subject.enable()).toEqual({
      state: "denied",
      optedIn: false,
    });
    expect(f.port.registerFcm).not.toHaveBeenCalled();
    expect(f.storage.getItem(key + "scope")).toBeNull();
  });

  it("cancels an old permission prompt without registering in either scope", async () => {
    const f = fixture();
    const permission = deferred<{ receive: string }>();
    f.messaging.requestPermissions.mockReturnValueOnce(permission.promise);
    const enabling = f.subject.enable();
    const rejected = expect(enabling).rejects.toThrow("scope changed");
    await vi.waitFor(() =>
      expect(f.messaging.requestPermissions).toHaveBeenCalledOnce(),
    );
    f.subject.bindScope({ key: "different-grant", timers: f.timers });
    permission.resolve({ receive: "granted" });
    await rejected;
    expect(f.port.registerFcm).not.toHaveBeenCalled();
    expect(f.storage.getItem(key + "scope")).toBeNull();
    expect(f.storage.getItem(key + "different-grant")).toBeNull();
  });

  it("aborts dispatched old-scope work and preserves uncertainty across restart", async () => {
    const f = fixture();
    const response = deferred<{
      channelId: string;
      installationId: string;
      criteria: string[];
      transport: "fcm";
    }>();
    f.port.registerFcm.mockReturnValueOnce(response.promise);
    const enabling = f.subject.enable();
    const rejected = expect(enabling).rejects.toMatchObject({
      code: "outcome_unknown",
    });
    await vi.waitFor(() => expect(f.port.registerFcm).toHaveBeenCalledOnce());
    const request = f.port.registerFcm.mock.calls[0][0];
    f.unbind();
    expect(request.signal.aborted).toBe(true);
    response.resolve({
      channelId: "channel",
      installationId: "installation",
      criteria: ["task.reminder"],
      transport: "fcm",
    });
    await rejected;
    f.subject.bindScope({ key: "scope", timers: f.timers });
    expect(await f.subject.status()).toEqual({
      state: "error",
      optedIn: false,
    });
    await f.subject.refreshRegistration();
    await expect(f.subject.enable()).rejects.toThrow("unresolved");
    expect(f.port.registerFcm).toHaveBeenCalledOnce();
    await f.subject.disable();
    expect(f.port.unregisterFcm).toHaveBeenCalledOnce();
    expect(f.messaging.deleteToken).toHaveBeenCalledOnce();
    expect(f.storage.getItem(key + "scope")).toBeNull();
  });

  it("never deletes the token or restores registration after failed unregister", async () => {
    const f = fixture();
    await f.subject.enable();
    f.port.unregisterFcm.mockRejectedValueOnce({ code: "outcome_unknown" });
    await expect(f.subject.disable()).rejects.toMatchObject({
      code: "outcome_unknown",
    });
    expect(f.messaging.deleteToken).not.toHaveBeenCalled();
    expect(f.storage.getItem(key + "scope")).toBe("stopping");
    await f.subject.refreshRegistration();
    expect(f.port.registerFcm).toHaveBeenCalledOnce();
    // Explicit cleanup can retry unregister; passive wake cannot.
    await f.subject.disableIfEnabled();
    expect(f.messaging.deleteToken).toHaveBeenCalledOnce();
  });

  it("keeps opt-out intent after local token deletion fails", async () => {
    const f = fixture();
    await f.subject.enable();
    f.messaging.deleteToken.mockRejectedValueOnce(new Error("bridge failed"));
    await expect(f.subject.disable()).rejects.toThrow("bridge failed");
    expect(f.port.unregisterFcm).toHaveBeenCalledOnce();
    await f.subject.refreshRegistration();
    expect(f.port.registerFcm).toHaveBeenCalledOnce();
    expect(await f.subject.status()).toEqual({
      state: "error",
      optedIn: false,
    });
  });

  it("ignores an old cleanup after binding a new scope", async () => {
    const f = fixture();
    f.subject.bindScope({ key: "new-scope", timers: f.timers });
    f.unbind();
    expect(await f.subject.status()).toEqual({ state: "off", optedIn: false });
    expect(f.port.close).not.toHaveBeenCalled();
  });

  it("rotates opted-in FCM tokens and refreshes generic wakes in the active scope", async () => {
    const f = fixture();
    const wake = vi.fn();
    const dispose = f.subject.listen(wake);
    await vi.waitFor(() => expect(f.listeners.size).toBe(3));
    await f.subject.enable();
    f.listeners.get("tokenReceived")!({ token: "rotated" });
    await vi.waitFor(() =>
      expect(f.port.registerFcm).toHaveBeenCalledWith(
        expect.objectContaining({
          token: "rotated",
          criteria: ["task.reminder"],
        }),
      ),
    );
    f.listeners.get("notificationActionPerformed")!({
      notification: {
        data: { ...signal, path: "private.md", title: "Private task" },
      },
    });
    expect(wake).toHaveBeenCalledWith({ notification: signal, opened: true });
    await vi.waitFor(() => expect(f.port.registerFcm).toHaveBeenCalledTimes(3));
    dispose();
  });

  it("stops stale callbacks and removes native listeners on scope changes", async () => {
    const f = fixture();
    const wake = vi.fn();
    f.subject.listen(wake);
    await vi.waitFor(() => expect(f.listeners.size).toBe(3));
    await f.subject.enable();
    f.subject.bindScope({ key: "new-scope", timers: f.timers });
    expect(f.remove).toHaveBeenCalledTimes(3);
    f.listeners.get("tokenReceived")!({ token: "stale" });
    f.listeners.get("notificationReceived")!({
      notification: { data: signal },
    });
    await f.subject.refreshRegistration();
    expect(wake).not.toHaveBeenCalled();
    expect(f.port.registerFcm).toHaveBeenCalledTimes(1);
  });

  it("does not rotate after opt-out even if the native listener stays attached", async () => {
    const f = fixture();
    const dispose = f.subject.listen(vi.fn());
    await f.subject.enable();
    await f.subject.disable();
    f.listeners.get("tokenReceived")!({ token: "after-optout" });
    await f.subject.refreshRegistration();
    expect(f.port.registerFcm).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("refreshes browser registration on a validated service-worker wake without prompting", async () => {
    const f = fixture(false);
    const wake = vi.fn();
    const dispose = f.subject.listen(wake);
    await f.subject.enable();
    f.webWake()({
      data: {
        type: "tasknotes:mdbase-notification",
        notification: signal,
        opened: false,
      },
    });
    expect(wake).toHaveBeenCalledWith({ notification: signal, opened: false });
    await vi.waitFor(() =>
      expect(f.port.registerWebPush).toHaveBeenCalledTimes(2),
    );
    expect(f.webPush.requestPermissions).toHaveBeenCalledTimes(1);
    dispose();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(native = true) {
  const storage = localStorage;
  storage.clear();
  let permission = "prompt";
  const listeners = new Map<string, (event: unknown) => void>();
  const remove = vi.fn(async () => undefined);
  const port = {
    registerFcm: vi.fn(async (options: { signal: AbortSignal }) => {
      void options;
      return {
        channelId: "channel",
        installationId: "installation",
        criteria: ["task.reminder"],
        transport: "fcm" as const,
      };
    }),
    unregisterFcm: vi.fn(async () => undefined),
    registerWebPush: vi.fn(async () => ({
      channelId: "channel",
      installationId: "installation",
      criteria: ["task.reminder"],
    })),
    unregisterWebPush: vi.fn(async () => undefined),
    close: vi.fn(),
  };
  const timers = new TimersApi(port as unknown as AppTimersPort);
  const messaging = {
    checkPermissions: vi.fn(async () => ({ receive: permission })),
    requestPermissions: vi.fn(async () => {
      permission = "granted";
      return { receive: permission };
    }),
    getToken: vi.fn(async () => ({ token: "fcm-token" })),
    deleteToken: vi.fn(async () => undefined),
    createChannel: vi.fn(async () => undefined),
    addListener: vi.fn(
      async (event: string, listener: (event: unknown) => void) => {
        listeners.set(event, listener);
        return { remove };
      },
    ),
  };
  let webListener!: (event: { data: unknown }) => void;
  const webPush = {
    isSupported: () => true,
    checkPermissions: vi.fn(async () => ({ receive: permission })),
    requestPermissions: vi.fn(async () => {
      permission = "granted";
      return { receive: permission };
    }),
    serviceWorker: vi.fn(async () => ({}) as ServiceWorkerRegistration),
    addListener: vi.fn(async (listener: typeof webListener) => {
      webListener = listener;
      return { remove };
    }),
  };
  const options: MdbaseNotificationManagerOptions = {
    messaging: messaging as unknown as NativeMessaging,
    webPush,
    storage,
    isNative: () => native,
    isConfigured: () => true,
  };
  const subject = new MdbaseNotificationManager(options);
  const unbind = subject.bindScope({ key: "scope", timers });
  return {
    subject,
    timers,
    port,
    storage,
    messaging,
    webPush,
    listeners,
    remove,
    unbind,
    permission: (value: string) => {
      permission = value;
    },
    webWake: () => webListener,
  };
}
